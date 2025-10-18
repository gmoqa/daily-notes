package handlers

import (
	"daily-notes/app"
	"daily-notes/middleware"
	"daily-notes/models"
	"daily-notes/services"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/oauth2"
)

// getToken extracts OAuth token from session
func getToken(c *fiber.Ctx) *oauth2.Token {
	sess, ok := c.Locals("session").(*models.Session)
	if !ok || sess == nil || sess.AccessToken == "" {
		return nil
	}

	return &oauth2.Token{
		AccessToken:  sess.AccessToken,
		RefreshToken: sess.RefreshToken,
		Expiry:       sess.TokenExpiry,
	}
}

// GetContexts retrieves all contexts for a user
func GetContexts(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID := middleware.GetUserID(c)

		contexts, err := a.ContextService.List(userID)
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

		// Validate request
		if err := a.Validator.Validate(&req); err != nil {
			return validationError(c, err)
		}

		userID := middleware.GetUserID(c)

		ctx, err := a.ContextService.Create(userID, req.Name, req.Color)
		if err != nil {
			if err == services.ErrContextAlreadyExists {
				return badRequest(c, "Context with this name already exists")
			}
			return serverErrorWithDetails(c, "Failed to create context", err)
		}

		return created(c, fiber.Map{"context": ctx})
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

		// Validate request
		if err := a.Validator.Validate(&req); err != nil {
			return validationError(c, err)
		}

		userID := middleware.GetUserID(c)
		token := getToken(c)

		if err := a.ContextService.Update(contextID, req.Name, req.Color, userID, token); err != nil {
			if err == services.ErrContextNotFound {
				return badRequest(c, "Context not found")
			}
			return serverErrorWithDetails(c, "Failed to update context", err)
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
		token := getToken(c)

		if err := a.ContextService.Delete(contextID, userID, token); err != nil {
			if err == services.ErrContextNotFound {
				return badRequest(c, "Context not found")
			}
			return serverErrorWithDetails(c, "Failed to delete context", err)
		}

		return success(c, fiber.Map{
			"message": "Context deleted successfully. All notes have been moved to _DELETED folder in Google Drive.",
		})
	}
}
