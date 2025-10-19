package setup

import (
	"daily-notes/config"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v2"
)

// NewFiberApp creates and configures a new Fiber application
func NewFiberApp(logger *slog.Logger) *fiber.App {
	return fiber.New(fiber.Config{
		ReadTimeout:           time.Second * 10,
		WriteTimeout:          time.Second * 10,
		IdleTimeout:           time.Second * 30,
		DisableStartupMessage: config.AppConfig.Env == "production",
		ErrorHandler:          CustomErrorHandler(logger),
		ReadBufferSize:        8192,
	})
}

// CustomErrorHandler returns a custom error handler for Fiber
func CustomErrorHandler(logger *slog.Logger) fiber.ErrorHandler {
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
