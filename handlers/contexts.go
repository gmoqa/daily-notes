package handlers

import (
	"daily-notes/models"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func GetContexts(c *fiber.Ctx) error {
	driveService, err := getDriveService(c)
	if err != nil {
		return serverError(c, "Failed to initialize Drive service")
	}

	contexts, err := driveService.GetContexts()
	if err != nil {
		return serverError(c, "Failed to fetch contexts")
	}

	return success(c, fiber.Map{"contexts": contexts})
}

func CreateContext(c *fiber.Ctx) error {
	var req models.CreateContextRequest
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "Invalid request body")
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return badRequest(c, "name is required")
	}
	if len(req.Name) > 100 {
		return badRequest(c, "name must be 100 characters or less")
	}
	if len(req.Name) < 2 {
		return badRequest(c, "name must be at least 2 characters")
	}

	validName := regexp.MustCompile(`^[\p{L}\p{N}\s\-_.,&()]+$`)
	if !validName.MatchString(req.Name) {
		return badRequest(c, "name contains invalid characters")
	}

	if req.Color != "" {
		validColor := regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
		if !validColor.MatchString(req.Color) {
			return badRequest(c, "color must be a valid hex color")
		}
	} else {
		req.Color = "#485fc7"
	}

	driveService, err := getDriveService(c)
	if err != nil {
		return serverError(c, "Failed to initialize Drive service")
	}

	context, err := driveService.CreateContext(req.Name, req.Color)
	if err != nil {
		return serverError(c, "Failed to create context")
	}
	return created(c, fiber.Map{"context": context})
}

func DeleteContext(c *fiber.Ctx) error {
	contextID := c.Params("id")
	if contextID == "" {
		return badRequest(c, "context ID is required")
	}

	driveService, err := getDriveService(c)
	if err != nil {
		return serverError(c, "Failed to initialize Drive service")
	}

	if err := driveService.DeleteContext(contextID); err != nil {
		return serverError(c, "Failed to delete context")
	}
	return success(c, fiber.Map{"message": "Context deleted successfully"})
}
