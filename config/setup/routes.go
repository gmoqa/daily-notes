package setup

import (
	"daily-notes/app"
	"daily-notes/handlers"
	"daily-notes/middleware"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

// RegisterRoutes registers all application routes
func RegisterRoutes(fiberApp *fiber.App, application *app.App) {

	// Static assets with aggressive caching
	fiberApp.Static("/static", "./static", fiber.Static{
		Compress:      true,
		CacheDuration: 365 * 24 * time.Hour, // 1 year for versioned assets
		MaxAge:        31536000,             // 1 year in seconds
	})
	fiberApp.Get("/robots.txt", func(c *fiber.Ctx) error {
		return c.SendFile("./static/robots.txt")
	})

	// Public routes
	fiberApp.Get("/", handlers.HomePage)
	fiberApp.Get("/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"status": "ok"}) })
	fiberApp.Get("/api/time", handlers.ServerTime)

	// Auth routes
	fiberApp.Post("/api/auth/login", handlers.Login(application))        // Legacy: GIS popup login
	fiberApp.Get("/auth/google", handlers.GoogleLogin(application))      // New: OAuth redirect login
	fiberApp.Get("/auth/google/callback", handlers.GoogleCallback(application)) // OAuth callback
	fiberApp.Post("/api/auth/logout", handlers.Logout(application))
	fiberApp.Get("/api/auth/me", handlers.Me(application))

	// Protected API routes
	api := fiberApp.Group("/api", middleware.AuthRequired(application.SessionStore), limiter.New(limiter.Config{
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
	api.Get("/sync/status", handlers.GetSyncStatus(application))
	api.Post("/sync/retry/:id", handlers.RetryNoteSync(application))
}
