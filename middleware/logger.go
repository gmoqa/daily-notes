package middleware

import (
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func StructuredLogger(logger *slog.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		requestID := uuid.New().String()

		c.Locals("requestID", requestID)
		c.Set("X-Request-ID", requestID)

		err := c.Next()

		status := c.Response().StatusCode()
		latency := time.Since(start)

		logAttrs := []slog.Attr{
			slog.String("request_id", requestID),
			slog.String("method", c.Method()),
			slog.String("path", c.Path()),
			slog.Int("status", status),
			slog.Duration("latency", latency),
			slog.String("ip", c.IP()),
			slog.String("user_agent", c.Get("User-Agent")),
		}

		if userID, ok := c.Locals("userID").(string); ok && userID != "" {
			logAttrs = append(logAttrs, slog.String("user_id", userID))
		}

		if err != nil {
			logAttrs = append(logAttrs, slog.String("error", err.Error()))
			logger.LogAttrs(c.Context(), slog.LevelError, "request error", logAttrs...)
		} else if status >= 500 {
			logger.LogAttrs(c.Context(), slog.LevelError, "server error", logAttrs...)
		} else if status >= 400 {
			logger.LogAttrs(c.Context(), slog.LevelWarn, "client error", logAttrs...)
		} else {
			logger.LogAttrs(c.Context(), slog.LevelInfo, "request completed", logAttrs...)
		}

		return err
	}
}
