package handlers

import (
	"daily-notes/app"
	"daily-notes/config"
	"daily-notes/models"
	"daily-notes/services"
	"log"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
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
			// Authorization Code Flow
			log.Printf("[AUTH] Using authorization code flow")
			loginResponse, err = a.AuthService.LoginWithCode(req.Code)
		} else if req.AccessToken != "" {
			// Direct Token Flow (legacy support)
			log.Printf("[AUTH] Using direct access token flow (no refresh token)")
			loginResponse, err = a.AuthService.LoginWithToken(req.AccessToken, req.RefreshToken, req.ExpiresIn)
		} else {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Either code or access_token is required",
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

		return c.JSON(fiber.Map{
			"success": true,
		})
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

// GoogleLogin redirects to Google OAuth consent screen
// This replaces the GIS (Google Identity Services) popup approach
func GoogleLogin(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Get OAuth config
		oauthConfig := &oauth2.Config{
			ClientID:     config.AppConfig.GoogleClientID,
			ClientSecret: config.AppConfig.GoogleClientSecret,
			RedirectURL:  config.AppConfig.GoogleRedirectURL,
			Scopes: []string{
				"https://www.googleapis.com/auth/drive.file",
				"https://www.googleapis.com/auth/userinfo.email",
			},
			Endpoint: google.Endpoint,
		}

		// Generate state token for CSRF protection
		state := generateStateToken()

		// Store state in session cookie (expires in 10 minutes)
		c.Cookie(&fiber.Cookie{
			Name:     "oauth_state",
			Value:    state,
			Expires:  time.Now().Add(10 * time.Minute),
			HTTPOnly: true,
			Secure:   config.AppConfig.Env == "production",
			SameSite: "Lax",
			Path:     "/",
		})

		// Build authorization URL with important parameters
		authURL := oauthConfig.AuthCodeURL(state,
			oauth2.AccessTypeOffline, // Request refresh token
			oauth2.ApprovalForce,      // Force approval prompt on first use only
		)

		log.Printf("[AUTH] Redirecting to Google OAuth: %s", authURL)

		// Redirect to Google
		return c.Redirect(authURL, fiber.StatusTemporaryRedirect)
	}
}

// GoogleCallback handles the OAuth callback from Google
func GoogleCallback(a *app.App) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Get state from cookie
		stateCookie := c.Cookies("oauth_state")
		if stateCookie == "" {
			log.Printf("[AUTH] Missing state cookie")
			return c.Redirect("/?error=invalid_state", fiber.StatusTemporaryRedirect)
		}

		// Clear the state cookie
		c.ClearCookie("oauth_state")

		// Verify state matches
		stateParam := c.Query("state")
		if stateParam != stateCookie {
			log.Printf("[AUTH] State mismatch: cookie=%s param=%s", stateCookie, stateParam)
			return c.Redirect("/?error=invalid_state", fiber.StatusTemporaryRedirect)
		}

		// Check for errors from Google
		if errParam := c.Query("error"); errParam != "" {
			log.Printf("[AUTH] OAuth error from Google: %s", errParam)
			return c.Redirect("/?error="+url.QueryEscape(errParam), fiber.StatusTemporaryRedirect)
		}

		// Get authorization code
		code := c.Query("code")
		if code == "" {
			log.Printf("[AUTH] Missing authorization code")
			return c.Redirect("/?error=missing_code", fiber.StatusTemporaryRedirect)
		}

		// Exchange code for tokens using existing auth service
		loginResponse, err := a.AuthService.LoginWithCode(code)
		if err != nil {
			log.Printf("[AUTH] Login failed: %v", err)
			return c.Redirect("/?error=login_failed", fiber.StatusTemporaryRedirect)
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

		log.Printf("[AUTH] Login successful for user %s, redirecting to home",
			loginResponse.Session.UserID)

		// Redirect back to home page (frontend will detect session and load app)
		return c.Redirect("/", fiber.StatusTemporaryRedirect)
	}
}

// generateStateToken generates a random state token for CSRF protection
func generateStateToken() string {
	// Simple implementation - you might want to use a more secure random generator
	return time.Now().Format("20060102150405") + "-" + config.AppConfig.GoogleClientID[:10]
}
