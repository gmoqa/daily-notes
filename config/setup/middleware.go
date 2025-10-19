package setup

import (
	"daily-notes/config"
	"daily-notes/middleware"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

// ApplyMiddleware applies all global middleware to the Fiber app
func ApplyMiddleware(app *fiber.App, logger *slog.Logger) {
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
}
