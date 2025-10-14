package main

import (
	"context"
	"daily-notes/config"
	"daily-notes/database"
	"daily-notes/handlers"
	"daily-notes/middleware"
	"daily-notes/session"
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
	handlers.SetRepository(repo)

	// Start session cleanup
	session.StartCleanupRoutine()
	logger.Info("session cleanup routine started")

	// Start sync worker for background Drive sync
	syncWorker := sync.NewWorker(repo, getUserToken)
	syncWorker.Start()
	handlers.SetSyncWorker(syncWorker)
	logger.Info("sync worker started")

	// Templ doesn't need a template engine - it renders directly
	app := fiber.New(fiber.Config{
		ReadTimeout:           time.Second * 10,
		WriteTimeout:          time.Second * 10,
		IdleTimeout:           time.Second * 30,
		DisableStartupMessage: config.AppConfig.Env == "production",
		ErrorHandler:          customErrorHandler(logger),
		ReadBufferSize:        8192,
	})

	app.Use(
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

	app.Static("/static", "./static", fiber.Static{Compress: true, MaxAge: 86400})
	app.Get("/robots.txt", func(c *fiber.Ctx) error {
		return c.SendFile("./static/robots.txt")
	})

	app.Get("/", handlers.HomePage)
	app.Get("/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"status": "ok"}) })
	app.Get("/api/time", handlers.ServerTime)

	app.Post("/api/auth/login", handlers.Login)
	app.Post("/api/auth/logout", handlers.Logout)
	app.Get("/api/auth/me", handlers.Me)

	api := app.Group("/api", middleware.AuthRequired(), limiter.New(limiter.Config{
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
	api.Get("/contexts", handlers.GetContexts)
	api.Post("/contexts", handlers.CreateContext)
	api.Put("/contexts/:id", handlers.UpdateContext)
	api.Delete("/contexts/:id", handlers.DeleteContext)
	api.Get("/notes", handlers.GetNote)
	api.Post("/notes", handlers.UpsertNote)
	api.Get("/notes/list", handlers.GetNotesByContext)
	api.Delete("/notes/:id", handlers.DeleteNote)
	api.Put("/settings", handlers.UpdateSettings)

	logger.Info("starting server", "port", config.AppConfig.Port, "env", config.AppConfig.Env)

	go func() {
		if err := app.Listen(":" + config.AppConfig.Port); err != nil {
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

	if err := app.ShutdownWithContext(ctx); err != nil {
		logger.Error("server forced to shutdown", "error", err)
	}

	logger.Info("server stopped")
}

// getUserToken retrieves the OAuth token for a user from their session
func getUserToken(userID string) (*oauth2.Token, error) {
	// Find session by userID
	sess := session.GetByUserID(userID)
	if sess == nil {
		return nil, fiber.ErrUnauthorized
	}

	return &oauth2.Token{
		AccessToken:  sess.AccessToken,
		RefreshToken: sess.RefreshToken,
		Expiry:       sess.TokenExpiry,
	}, nil
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
