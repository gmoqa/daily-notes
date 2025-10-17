package handlers

import (
	"daily-notes/config"
	"daily-notes/templates/pages"
	"time"

	"github.com/gofiber/fiber/v2"
)

func HomePage(c *fiber.Ctx) error {
	// Set HTML content type
	c.Set("Content-Type", "text/html; charset=utf-8")
	// Render with Templ
	return pages.Index(config.AppConfig.GoogleClientID, config.AppConfig.Env).Render(c.Context(), c.Response().BodyWriter())
}

func ServerTime(c *fiber.Ctx) error {
	timezone := c.Query("timezone", "UTC")

	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}

	now := time.Now().In(loc)

	return c.JSON(fiber.Map{
		"timestamp": now.Unix(),
		"timezone":  timezone,
		"iso":       now.Format(time.RFC3339),
	})
}
