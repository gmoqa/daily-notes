package handlers

import (
	"daily-notes/app"
	"daily-notes/middleware"
	"daily-notes/models"
	"daily-notes/services"

	"github.com/gofiber/fiber/v2"
)

// GetNote retrieves a note for a specific context and date
func GetNote(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		contextName, date := c.Query("context"), c.Query("date")
		if contextName == "" || date == "" {
			return badRequest(c, "context and date are required")
		}

		userID := middleware.GetUserID(c)

		note, err := a.NoteService.Get(userID, contextName, date)
		if err != nil {
			return serverErrorWithDetails(c, "Failed to fetch note", err)
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

		// Validate request
		if err := a.Validator.Validate(&req); err != nil {
			return validationError(c, err)
		}

		userID := middleware.GetUserID(c)

		note, err := a.NoteService.Upsert(userID, req.Context, req.Date, req.Content)
		if err != nil {
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
		userID := middleware.GetUserID(c)

		notes, err := a.NoteService.ListByContext(userID, contextName, limit, offset)
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

		if err := a.NoteService.Delete(userID, contextName, date); err != nil {
			return serverErrorWithDetails(c, "Failed to delete note", err)
		}

		return success(c, fiber.Map{
			"message": "Note deleted successfully",
		})
	}
}

// GetSyncStatus returns sync status information for the user
func GetSyncStatus(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID := middleware.GetUserID(c)

		syncStatus, err := a.NoteService.GetSyncStatus(userID)
		if err != nil {
			return serverErrorWithDetails(c, "Failed to get sync status", err)
		}

		return success(c, fiber.Map{
			"sync_status": syncStatus,
		})
	}
}

// RetryNoteSync retries synchronization for a failed note
func RetryNoteSync(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		noteID := c.Params("id")
		if noteID == "" {
			return badRequest(c, "note ID is required")
		}

		userID := middleware.GetUserID(c)

		if err := a.NoteService.RetrySync(noteID, userID); err != nil {
			if err == services.ErrUnauthorized {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "Access denied",
				})
			}
			return serverErrorWithDetails(c, "Failed to retry sync", err)
		}

		return success(c, fiber.Map{
			"message": "Note queued for sync retry",
		})
	}
}
