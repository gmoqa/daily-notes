package handlers

import (
	"context"
	"daily-notes/drive"
	"daily-notes/middleware"
	"daily-notes/models"

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

func GetNote(c *fiber.Ctx) error {
	contextName, date := c.Query("context"), c.Query("date")
	if contextName == "" || date == "" {
		return badRequest(c, "context and date are required")
	}

	driveService, err := getDriveService(c)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to initialize Drive service", err)
	}

	note, err := driveService.GetNote(contextName, date)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch note", err)
	}

	if note == nil {
		return success(c, fiber.Map{"note": fiber.Map{
			"user_id": middleware.GetUserID(c),
			"context": contextName,
			"date":    date,
			"content": "",
		}})
	}

	return success(c, fiber.Map{"note": note})
}

func UpsertNote(c *fiber.Ctx) error {
	var req models.CreateNoteRequest
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "Invalid request body")
	}
	if req.Context == "" || req.Date == "" {
		return badRequest(c, "context and date are required")
	}

	driveService, err := getDriveService(c)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to initialize Drive service", err)
	}

	note, err := driveService.UpsertNote(req.Context, req.Date, req.Content)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to save note", err)
	}
	return success(c, fiber.Map{"note": note})
}

func GetNotesByContext(c *fiber.Ctx) error {
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

	driveService, err := getDriveService(c)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to initialize Drive service", err)
	}

	notes, err := driveService.GetNotesByContext(contextName, limit, offset)
	if err != nil {
		return serverErrorWithDetails(c, "Failed to fetch notes", err)
	}
	return success(c, fiber.Map{
		"notes":  notes,
		"limit":  limit,
		"offset": offset,
	})
}

func DeleteNote(c *fiber.Ctx) error {
	return success(c, fiber.Map{"message": "Note deletion not implemented with Drive storage"})
}
