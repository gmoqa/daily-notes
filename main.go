package main

import (
	"context"
	"daily-notes/app"
	"daily-notes/config"
	"daily-notes/database"
	"daily-notes/handlers"
	"daily-notes/middleware"
	"daily-notes/session"
	"daily-notes/storage"
	"daily-notes/sync"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"golang.org/x/oauth2"
)

func main() {
	config.Load()

	logger := setupLogger()
	slog.SetDefault(logger)

	// Initialize SQLite database
	dbPath := config.GetEnv("DB_PATH", "./data/daily-notes.db")
	db, err := database.New(dbPath)
	if err != nil {
		logger.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Migrate(); err != nil {
		logger.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}
	logger.Info("database initialized", "path", dbPath)

	// Create repository
	repo := database.NewRepository(db)

	// Initialize session store with database
	sessionStore := session.NewStore(db.DB)
	logger.Info("session store initialized with database")

	// Start session cleanup
	sessionStore.StartCleanupRoutine()
	logger.Info("session cleanup routine started")

	// Create getUserToken function that uses sessionStore
	getUserToken := func(userID string) (*oauth2.Token, error) {
		sess := sessionStore.GetByUserID(userID)
		if sess == nil {
			return nil, fiber.ErrUnauthorized
		}
		return &oauth2.Token{
			AccessToken:  sess.AccessToken,
			RefreshToken: sess.RefreshToken,
			Expiry:       sess.TokenExpiry,
		}, nil
	}

	// Create storage factory (using Drive as the implementation)
	storageFactory := storage.NewDriveProvider
	logger.Info("storage factory configured with Drive provider")

	// Start sync worker for background sync
	syncWorker := sync.NewWorker(repo, sessionStore, storageFactory, getUserToken)
	syncWorker.Start()
	logger.Info("sync worker started")

	// Create App with all dependencies injected
	application := app.New(repo, syncWorker, sessionStore, storageFactory, logger)
	logger.Info("application initialized with dependency injection")

	// Templ doesn't need a template engine - it renders directly
	fiberApp := fiber.New(fiber.Config{
		ReadTimeout:           time.Second * 10,
		WriteTimeout:          time.Second * 10,
		IdleTimeout:           time.Second * 30,
		DisableStartupMessage: config.AppConfig.Env == "production",
		ErrorHandler:          customErrorHandler(logger),
		ReadBufferSize:        8192,
	})

	fiberApp.Use(
		recover.New(),
		middleware.StructuredLogger(logger),
		middleware.Security(),
		cors.New(cors.Config{
			AllowOrigins:     config.GetEnv("CORS_ORIGINS", "*"),
			AllowMethods:     "GET,POST,PUT,DELETE,OPTIONS",
			AllowHeaders:     "Origin,Content-Type,Accept,Authorization",
			AllowCredentials: false,
			MaxAge:           86400,
		}),
		limiter.New(limiter.Config{
			Max:        200,
			Expiration: time.Minute,
			KeyGenerator: func(c *fiber.Ctx) string {
				return c.IP()
			},
			LimitReached: func(c *fiber.Ctx) error {
				return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
					"error": "Rate limit exceeded",
				})
			},
		}),
	)

	// Static assets with aggressive caching
	fiberApp.Static("/static", "./static", fiber.Static{
		Compress:      true,
		CacheDuration: 365 * 24 * time.Hour, // 1 year for versioned assets
		MaxAge:        31536000,             // 1 year in seconds
	})
	fiberApp.Get("/robots.txt", func(c *fiber.Ctx) error {
		return c.SendFile("./static/robots.txt")
	})

	fiberApp.Get("/", handlers.HomePage)
	fiberApp.Get("/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"status": "ok"}) })
	fiberApp.Get("/api/time", handlers.ServerTime)

	fiberApp.Post("/api/auth/login", handlers.Login(application))
	fiberApp.Post("/api/auth/logout", handlers.Logout(application))
	fiberApp.Get("/api/auth/me", handlers.Me(application))

	api := fiberApp.Group("/api", middleware.AuthRequired(sessionStore), limiter.New(limiter.Config{
		Max:        100,
		Expiration: time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			if userID, ok := c.Locals("userID").(string); ok {
				return "user:" + userID
			}
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "Rate limit exceeded for your account",
			})
		},
	}))
	api.Get("/contexts", handlers.GetContexts(application))
	api.Post("/contexts", handlers.CreateContext(application))
	api.Put("/contexts/:id", handlers.UpdateContext(application))
	api.Delete("/contexts/:id", handlers.DeleteContext(application))
	api.Get("/notes", handlers.GetNote(application))
	api.Post("/notes", handlers.UpsertNote(application))
	api.Get("/notes/list", handlers.GetNotesByContext(application))
	api.Delete("/notes/:context/:date", handlers.DeleteNote(application))
	api.Put("/settings", handlers.UpdateSettings(application))
	// NOTE: Drive sync is now handled automatically on login via AuthService
	// api.Post("/sync/drive", handlers.SyncFromDrive(application)) // Removed - auto-sync on login
	api.Get("/sync/status", handlers.GetSyncStatus(application))
	api.Post("/sync/retry/:id", handlers.RetryNoteSync(application))

	logger.Info("starting server", "port", config.AppConfig.Port, "env", config.AppConfig.Env)

	go func() {
		if err := fiberApp.Listen(":" + config.AppConfig.Port); err != nil {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server gracefully")

	// Stop sync worker
	syncWorker.Stop()
	logger.Info("sync worker stopped")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := fiberApp.ShutdownWithContext(ctx); err != nil {
		logger.Error("server forced to shutdown", "error", err)
	}

	logger.Info("server stopped")
}

func setupLogger() *slog.Logger {
	var handler slog.Handler

	opts := &slog.HandlerOptions{
		Level:     getLogLevel(),
		AddSource: config.AppConfig.Env == "development",
	}

	if config.AppConfig.Env == "production" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return slog.New(handler)
}

func getLogLevel() slog.Level {
	level := config.GetEnv("LOG_LEVEL", "info")
	switch level {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func customErrorHandler(logger *slog.Logger) fiber.ErrorHandler {
	return func(c *fiber.Ctx, err error) error {
		code := fiber.StatusInternalServerError
		message := "Internal server error"

		if e, ok := err.(*fiber.Error); ok {
			code = e.Code
			message = e.Message
		}

		requestID := ""
		if id, ok := c.Locals("requestID").(string); ok {
			requestID = id
		}

		logger.Error("request failed",
			"request_id", requestID,
			"method", c.Method(),
			"path", c.Path(),
			"status", code,
			"error", err,
		)

		return c.Status(code).JSON(fiber.Map{
			"error":      message,
			"request_id": requestID,
		})
	}
}
