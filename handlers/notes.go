package handlers

import (
	"context"
	"daily-notes/app"
	"daily-notes/drive"
	"daily-notes/middleware"
	"daily-notes/models"
	"time"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/oauth2"
)

func getDriveService(c *fiber.Ctx) (*drive.Service, error) {
	sess, ok := c.Locals("session").(*models.Session)
	if !ok || sess == nil {
		return nil, fiber.ErrUnauthorized
	}

	if sess.AccessToken == "" {
		return nil, &fiber.Error{
			Code:    fiber.StatusForbidden,
			Message: "Google Drive access not authorized. Please sign in again with Drive permissions.",
		}
	}

	token := &oauth2.Token{
		AccessToken:  sess.AccessToken,
		RefreshToken: sess.RefreshToken,
		Expiry:       sess.TokenExpiry,
	}

	return drive.NewService(context.Background(), token, sess.UserID)
}

// GetNote retrieves a note for a specific context and date
func GetNote(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
	contextName, date := c.Query("context"), c.Query("date")
	if contextName == "" || date == "" {
		return badRequest(c, "context and date are required")
	}

	userID := middleware.GetUserID(c)

	// Try local database first (fast path)
	note, err := a.Repo.GetNote(userID, contextName, date)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch note from database", err)
	}

	if note == nil {
		// Return empty note
		return success(c, fiber.Map{"note": fiber.Map{
			"user_id": userID,
			"context": contextName,
			"date":    date,
			"content": "",
		}})
	}

	return success(c, fiber.Map{"note": note})
	}
}

// UpsertNote creates or updates a note
func UpsertNote(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
	var req models.CreateNoteRequest
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "Invalid request body")
	}
	if req.Context == "" || req.Date == "" {
		return badRequest(c, "context and date are required")
	}

	userID := middleware.GetUserID(c)

	// Save to local database immediately (fast response)
	note := &models.Note{
		UserID:    userID,
		Context:   req.Context,
		Date:      req.Date,
		Content:   req.Content,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Mark for sync with Drive (sync_pending = true)
	if err := a.Repo.UpsertNote(note, true); err != nil {
		return serverErrorWithDetails(c, "Failed to save note", err)
	}

	return success(c, fiber.Map{"note": note})
	}
}

// GetNotesByContext retrieves all notes for a specific context
func GetNotesByContext(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
	contextName := c.Query("context")
	if contextName == "" {
		return badRequest(c, "context is required")
	}

	limit := c.QueryInt("limit", 30)
	offset := c.QueryInt("offset", 0)

	if limit < 1 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}

	userID := middleware.GetUserID(c)

	// Get from local database (instant)
	notes, err := a.Repo.GetNotesByContext(userID, contextName, limit, offset)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch notes", err)
	}

	return success(c, fiber.Map{
		"notes":  notes,
		"limit":  limit,
		"offset": offset,
	})
	}
}

// DeleteNote marks a note as deleted
func DeleteNote(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
	contextName := c.Params("context")
	date := c.Params("date")

	if contextName == "" || date == "" {
		return badRequest(c, "context and date are required")
	}

	userID := middleware.GetUserID(c)

	// Mark note as deleted (will be synced by background worker)
	if err := a.Repo.DeleteNote(userID, contextName, date); err != nil {
		return serverErrorWithDetails(c, "Failed to delete note", err)
	}

	return success(c, fiber.Map{
		"message": "Note deleted successfully",
	})
	}
}
