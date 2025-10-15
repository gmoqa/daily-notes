package handlers

import (
	"daily-notes/middleware"
	"daily-notes/models"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func GetContexts(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	// Get from local database (instant)
	contexts, err := repo.GetContexts(userID)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch contexts", err)
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

	// Validate color is from Bulma palette
	validColors := map[string]bool{
		"text":    true,
		"link":    true,
		"primary": true,
		"info":    true,
		"success": true,
		"warning": true,
		"danger":  true,
	}

	if req.Color == "" {
		req.Color = "primary"
	} else if !validColors[req.Color] {
		return badRequest(c, "color must be one of: text, link, primary, info, success, warning, danger")
	}

	userID := middleware.GetUserID(c)

	// Check if context already exists
	existing, err := repo.GetContextByName(userID, req.Name)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to check existing context", err)
	}
	if existing != nil {
		return badRequest(c, "Context with this name already exists")
	}

	// Create in local database immediately
	context := &models.Context{
		ID:        uuid.New().String(),
		UserID:    userID,
		Name:      req.Name,
		Color:     req.Color,
		CreatedAt: time.Now(),
	}

	if err := repo.CreateContext(context); err != nil {
		return serverErrorWithDetails(c, "Failed to create context", err)
	}

	// Context will be synced to Drive by the background worker when notes are created
	return created(c, fiber.Map{"context": context})
}

func UpdateContext(c *fiber.Ctx) error {
	contextID := c.Params("id")
	if contextID == "" {
		return badRequest(c, "context ID is required")
	}

	var req models.UpdateContextRequest
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

	// Validate color is from Bulma palette
	validColors := map[string]bool{
		"text":    true,
		"link":    true,
		"primary": true,
		"info":    true,
		"success": true,
		"warning": true,
		"danger":  true,
	}

	if req.Color == "" {
		req.Color = "primary"
	} else if !validColors[req.Color] {
		return badRequest(c, "color must be one of: text, link, primary, info, success, warning, danger")
	}

	// Get the old context to check if name is changing
	oldContext, err := repo.GetContextByID(contextID)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch context", err)
	}
	if oldContext == nil {
		return badRequest(c, "Context not found")
	}

	userID := middleware.GetUserID(c)

	// If name changed, we need to update all notes that use this context
	nameChanged := oldContext.Name != req.Name

	// Update context in local database
	if err := repo.UpdateContext(contextID, req.Name, req.Color); err != nil {
		return serverErrorWithDetails(c, "Failed to update context", err)
	}

	// If name changed, update all notes with the new context name
	if nameChanged {
		if err := repo.UpdateNotesContextName(oldContext.Name, req.Name, userID); err != nil {
			return serverErrorWithDetails(c, "Failed to update notes with new context name", err)
		}

		// Also rename folder in Google Drive
		driveService, err := getDriveService(c)
		if err != nil {
			// Log error but don't fail the request since local DB was updated
			// User can manually rename the folder or it will be created on next sync
			c.Append("X-Warning", "Context updated locally but Drive sync failed. Please check your Google Drive connection.")
		} else {
			if err := driveService.RenameContext(contextID, oldContext.Name, req.Name); err != nil {
				// Log error but don't fail the request
				c.Append("X-Warning", "Context updated locally but Drive folder rename failed. You may need to manually rename the folder in Google Drive.")
			}
		}
	}

	return success(c, fiber.Map{"message": "Context updated successfully"})
}

func DeleteContext(c *fiber.Ctx) error {
	contextID := c.Params("id")
	if contextID == "" {
		return badRequest(c, "context ID is required")
	}

	// Delete from local database
	if err := repo.DeleteContext(contextID); err != nil {
		return serverErrorWithDetails(c, "Failed to delete context", err)
	}

	// Note: Deletion from Drive should be handled manually or by a separate cleanup job
	return success(c, fiber.Map{"message": "Context deleted successfully"})
}
