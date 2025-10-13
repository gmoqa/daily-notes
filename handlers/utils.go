package handlers

import "github.com/gofiber/fiber/v2"

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
