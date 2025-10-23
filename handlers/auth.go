package handlers

import (
	"daily-notes/app"
	"daily-notes/config"
	"daily-notes/models"
	"daily-notes/services"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Login handles user authentication via Google OAuth
func Login(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req models.LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		// Delegate to AuthService based on login method
		var loginResponse *services.LoginResponse
		var err error

		if req.Code != "" {
			// Authorization Code Flow (modern, recommended)
			log.Printf("[AUTH] Using authorization code flow")
			loginResponse, err = a.AuthService.LoginWithCode(req.Code)
		} else if req.IDToken != "" {
			// One Tap Sign-in (ID token from Google)
			log.Printf("[AUTH] Using One Tap ID token flow")
			loginResponse, err = a.AuthService.LoginWithIDToken(req.IDToken)
		} else if req.AccessToken != "" {
			// Direct Token Flow (legacy support)
			log.Printf("[AUTH] Using direct access token flow (legacy)")
			loginResponse, err = a.AuthService.LoginWithToken(req.AccessToken, req.RefreshToken, req.ExpiresIn)
		} else {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "code, id_token, or access_token is required",
			})
		}

		// Handle authentication errors
		if err != nil {
			log.Printf("[AUTH] Login failed: %v", err)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Authentication failed",
			})
		}

		// Set session cookie
		cookie := &fiber.Cookie{
			Name:     "session_id",
			Value:    loginResponse.Session.ID,
			Expires:  loginResponse.Session.ExpiresAt,
			HTTPOnly: true,
			Secure:   config.AppConfig.Env == "production",
			SameSite: "Lax",
			Path:     "/",
		}
		c.Cookie(cookie)

		// Perform post-login operations (Drive import, cleanup) in background
		a.AuthService.HandlePostLogin(loginResponse)

		// Return response
		log.Printf("[AUTH] Login successful for user %s (hasNoContexts=%v)",
			loginResponse.Session.UserID, loginResponse.HasNoContexts)

		return c.JSON(fiber.Map{
			"success": true,
			"user": fiber.Map{
				"id":            loginResponse.Session.UserID,
				"email":         loginResponse.Session.Email,
				"name":          loginResponse.Session.Name,
				"picture":       loginResponse.Session.Picture,
				"settings":      loginResponse.Session.Settings,
				"hasNoContexts": loginResponse.HasNoContexts,
			},
		})
	}
}

// Logout handles user logout
func Logout(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		sessionID := c.Cookies("session_id")
		if sessionID != "" {
			a.AuthService.Logout(sessionID)
		}

		c.ClearCookie("session_id")

		// Redirect to home page after logout
		return c.Redirect("/", fiber.StatusSeeOther)
	}
}

// Me returns the current user's session information
func Me(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		sessionID := c.Cookies("session_id")
		if sessionID == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"authenticated": false,
			})
		}

		sess, err := a.AuthService.GetSessionInfo(sessionID)
		if err != nil {
			c.ClearCookie("session_id")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"authenticated": false,
			})
		}

		// Update last used timestamp
		sess.LastUsedAt = time.Now()
		a.SessionStore.Update(sessionID, sess)

		return c.JSON(fiber.Map{
			"authenticated": true,
			"user": fiber.Map{
				"id":       sess.UserID,
				"email":    sess.Email,
				"name":     sess.Name,
				"picture":  sess.Picture,
				"settings": sess.Settings,
			},
		})
	}
}

// UpdateSettings updates user settings
func UpdateSettings(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req models.UpdateSettingsRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		// Validate request
		if err := a.Validator.Validate(&req); err != nil {
			return validationError(c, err)
		}

		sessionID := c.Cookies("session_id")
		sess, err := a.AuthService.GetSessionInfo(sessionID)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Unauthorized",
			})
		}

		settings := models.UserSettings{
			Theme:                req.Theme,
			WeekStart:            req.WeekStart,
			Timezone:             req.Timezone,
			DateFormat:           req.DateFormat,
			UniqueContextMode:    req.UniqueContextMode,
			ShowBreadcrumb:       req.ShowBreadcrumb,
			ShowMarkdownEditor:   req.ShowMarkdownEditor,
			HideNewContextButton: req.HideNewContextButton,
		}

		if err := a.Repo.UpdateUserSettings(sess.UserID, settings); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to update settings",
			})
		}

		// Update session with new settings
		sess.Settings = settings
		a.SessionStore.Update(sessionID, sess)

		return c.JSON(fiber.Map{
			"success": true,
			"settings": settings,
		})
	}
}
