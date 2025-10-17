package handlers

import (
	"daily-notes/app"
	"daily-notes/middleware"
	"daily-notes/models"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// GetContexts retrieves all contexts for a user
func GetContexts(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	// Get from local database (instant)
	contexts, err := a.Repo.GetContexts(userID)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch contexts", err)
	}

	return success(c, fiber.Map{"contexts": contexts})
	}
}

// CreateContext creates a new context for a user
func CreateContext(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
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
	existing, err := a.Repo.GetContextByName(userID, req.Name)
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

	if err := a.Repo.CreateContext(context); err != nil {
		return serverErrorWithDetails(c, "Failed to create context", err)
	}

	// Context will be synced to Drive by the background worker when notes are created
	return created(c, fiber.Map{"context": context})
	}
}

// UpdateContext updates an existing context
func UpdateContext(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
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
	oldContext, err := a.Repo.GetContextByID(contextID)
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
	if err := a.Repo.UpdateContext(contextID, req.Name, req.Color); err != nil {
		return serverErrorWithDetails(c, "Failed to update context", err)
	}

	// If name changed, update all notes with the new context name
	if nameChanged {
		if err := a.Repo.UpdateNotesContextName(oldContext.Name, req.Name, userID); err != nil {
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
}

// DeleteContext deletes a context and its notes
func DeleteContext(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
	contextID := c.Params("id")
	if contextID == "" {
		return badRequest(c, "context ID is required")
	}

	userID := middleware.GetUserID(c)

	// Get the context to retrieve its name
	context, err := a.Repo.GetContextByID(contextID)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch context", err)
	}
	if context == nil {
		return badRequest(c, "Context not found")
	}

	// Get all notes for this context and mark them as deleted
	// This will trigger the sync worker to delete them from Drive
	notes, err := a.Repo.GetNotesByContext(userID, context.Name, 1000, 0)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch notes", err)
	}

	// Mark all notes in this context as deleted (soft delete with sync pending)
	for _, note := range notes {
		if err := a.Repo.DeleteNote(userID, context.Name, note.Date); err != nil {
			// Log but continue
			c.Append("X-Warning", "Some notes failed to be marked for deletion")
		}
	}

	// Delete from local database
	if err := a.Repo.DeleteContext(contextID); err != nil {
		return serverErrorWithDetails(c, "Failed to delete context", err)
	}

	// Move folder to _DELETED in Google Drive (async)
	go func() {
		driveService, err := getDriveService(c)
		if err != nil {
			// Can't get drive service, skip Drive sync
			return
		}

		if err := driveService.DeleteContext(contextID, context.Name); err != nil {
			// Log error but context is already deleted locally
			// The sync worker will handle note deletions
		}
	}()

	return success(c, fiber.Map{
		"message": "Context deleted successfully. All notes have been moved to _DELETED folder in Google Drive.",
	})
	}
}
