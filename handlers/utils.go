package handlers

import (
	"log/slog"

	"github.com/gofiber/fiber/v2"
)

func success(c *fiber.Ctx, data fiber.Map) error {
	return c.JSON(data)
}

func created(c *fiber.Ctx, data fiber.Map) error {
	return c.Status(fiber.StatusCreated).JSON(data)
}

func badRequest(c *fiber.Ctx, message string) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": message})
}

func serverError(c *fiber.Ctx, message string) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": message})
}

func serverErrorWithDetails(c *fiber.Ctx, message string, err error) error {
	requestID := ""
	if id, ok := c.Locals("requestID").(string); ok {
		requestID = id
	}

	slog.Error("server error",
		"request_id", requestID,
		"method", c.Method(),
		"path", c.Path(),
		"message", message,
		"error", err,
	)

	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": message})
}
