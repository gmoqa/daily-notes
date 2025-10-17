package handlers

import (
	"context"
	"daily-notes/config"
	"daily-notes/drive"
	"daily-notes/models"
	"daily-notes/session"
	"daily-notes/sync"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

var syncWorker *sync.Worker

func SetSyncWorker(w *sync.Worker) {
	syncWorker = w
}

func Login(c *fiber.Ctx) error {
	var req models.LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Support both authorization code flow and direct token flow
	var token *oauth2.Token
	var googleID, email, name, picture string

	if req.Code != "" {
		// Authorization Code Flow - exchange code for tokens
		log.Printf("[AUTH] Using authorization code flow")
		
		ctx := context.Background()
		oauthConfig := &oauth2.Config{
			ClientID:     config.AppConfig.GoogleClientID,
			ClientSecret: config.AppConfig.GoogleClientSecret,
			RedirectURL:  config.AppConfig.GoogleRedirectURL,
			Scopes: []string{
				"https://www.googleapis.com/auth/drive.file",
				"https://www.googleapis.com/auth/userinfo.profile",
				"https://www.googleapis.com/auth/userinfo.email",
			},
			Endpoint: google.Endpoint,
		}

		// Exchange authorization code for tokens
		tok, err := oauthConfig.Exchange(ctx, req.Code)
		if err != nil {
			log.Printf("[AUTH] Failed to exchange code: %v", err)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Failed to exchange authorization code",
			})
		}
		token = tok

		// Get user info using the access token
		userInfoURL := "https://www.googleapis.com/oauth2/v3/userinfo"
		httpReq, err := http.NewRequest("GET", userInfoURL, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create request",
			})
		}
		httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Failed to get user info",
			})
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Invalid token",
			})
		}

		var userInfo map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Failed to parse user info",
			})
		}

		googleID, _ = userInfo["sub"].(string)
		email, _ = userInfo["email"].(string)
		name, _ = userInfo["name"].(string)
		picture, _ = userInfo["picture"].(string)

		log.Printf("[AUTH] Successfully exchanged code for tokens. Has refresh token: %v", token.RefreshToken != "")

	} else if req.AccessToken != "" {
		// Direct Token Flow (legacy support)
		log.Printf("[AUTH] Using direct access token flow (no refresh token)")
		
		tokenExpiry := time.Now().Add(1 * time.Hour)
		if req.ExpiresIn > 0 {
			tokenExpiry = time.Now().Add(time.Duration(req.ExpiresIn) * time.Second)
		}

		token = &oauth2.Token{
			AccessToken:  req.AccessToken,
			RefreshToken: req.RefreshToken,
			Expiry:       tokenExpiry,
		}

		// Validate access token by calling Google's userinfo endpoint
		userInfoURL := "https://www.googleapis.com/oauth2/v3/userinfo"
		httpReq, err := http.NewRequest("GET", userInfoURL, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create request",
			})
		}
		httpReq.Header.Set("Authorization", "Bearer "+req.AccessToken)

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Failed to validate token",
			})
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Invalid Google token",
			})
		}

		var userInfo map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Failed to parse user info",
			})
		}

		googleID, _ = userInfo["sub"].(string)
		email, _ = userInfo["email"].(string)
		name, _ = userInfo["name"].(string)
		picture, _ = userInfo["picture"].(string)
	} else {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Either code or access_token is required",
		})
	}

	if googleID == "" || email == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid user information",
		})
	}

	defaultSettings := models.UserSettings{
		Theme:      "dark",
		WeekStart:  0,
		Timezone:   "UTC",
		DateFormat: "DD-MM-YY",
	}

	userSettings := defaultSettings
	if token.AccessToken != "" {
		driveService, err := drive.NewService(context.Background(), token, googleID)
		if err == nil {
			settings, err := driveService.GetSettings()
			if err == nil {
				userSettings = settings
			}
		}
	}

	// Save/update user in database BEFORE creating session (due to foreign key constraint)
	user := &models.User{
		ID:          googleID,
		GoogleID:    googleID,
		Email:       email,
		Name:        name,
		Picture:     picture,
		Settings:    userSettings,
		CreatedAt:   time.Now(),
		LastLoginAt: time.Now(),
	}

	if err := repo.UpsertUser(user); err != nil {
		log.Printf("Failed to save user to database: %v", err)
		return &fiber.Error{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to save user",
		}
	}

	sess, err := session.Create(
		googleID,
		email,
		name,
		picture,
		token.AccessToken,
		token.RefreshToken,
		token.Expiry,
		userSettings,
	)
	if err != nil {
		return &fiber.Error{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to create session",
		}
	}

	expiresAt := sess.ExpiresAt
	cookie := &fiber.Cookie{
		Name:     "session_id",
		Value:    sess.ID,
		Expires:  expiresAt,
		HTTPOnly: true,
		Secure:   config.AppConfig.Env == "production",
		SameSite: "Lax",
		Path:     "/",
	}
	c.Cookie(cookie)

	// Check if this is first login by checking Google Drive
	isFirstLogin := false
	if token.AccessToken != "" {
		driveService, err := drive.NewService(context.Background(), token, googleID)
		if err == nil {
			firstLogin, err := driveService.IsFirstLogin()
			if err == nil {
				isFirstLogin = firstLogin
			} else {
				log.Printf("Failed to check first login status: %v", err)
			}

			// Cleanup old deleted folders (older than 10 days) in background
			go func() {
				if err := driveService.CleanupOldDeletedFolders(); err != nil {
					log.Printf("[AUTH] Failed to cleanup old deleted folders for user %s: %v", googleID, err)
				} else {
					log.Printf("[AUTH] Successfully cleaned up old deleted folders for user %s", googleID)
				}
			}()
		}
	}

	// Check if this is first login (no data in local DB)
	contexts, err := repo.GetContexts(googleID)
	if err == nil && len(contexts) == 0 && syncWorker != nil {
		// Import data from Drive in background
		go func() {
			log.Printf("First login detected for user %s, importing from Drive...", googleID)
			if err := syncWorker.ImportFromDrive(googleID, token); err != nil {
				log.Printf("Failed to import from Drive: %v", err)
			} else {
				log.Printf("Successfully imported data from Drive for user %s", googleID)
			}
		}()
	}

	return c.JSON(fiber.Map{
		"success": true,
		"user": fiber.Map{
			"id":          sess.UserID,
			"email":       sess.Email,
			"name":        sess.Name,
			"picture":     sess.Picture,
			"settings":    sess.Settings,
			"isFirstLogin": isFirstLogin,
		},
	})
}

func Logout(c *fiber.Ctx) error {
	sessionID := c.Cookies("session_id")
	if sessionID != "" {
		session.Delete(sessionID)
	}

	c.ClearCookie("session_id")

	return c.JSON(fiber.Map{
		"success": true,
	})
}

func Me(c *fiber.Ctx) error {
	sessionID := c.Cookies("session_id")
	if sessionID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"authenticated": false,
		})
	}

	sess, err := session.Get(sessionID)
	if err != nil || sess == nil {
		c.ClearCookie("session_id")
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"authenticated": false,
		})
	}

	sess.LastUsedAt = time.Now()
	session.Update(sessionID, sess)

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

func UpdateSettings(c *fiber.Ctx) error {
	var req models.UpdateSettingsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	sessionID := c.Cookies("session_id")
	sess, err := session.Get(sessionID)
	if err != nil || sess == nil {
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

	// Update in local database
	if err := repo.UpdateUserSettings(sess.UserID, settings); err != nil {
		log.Printf("Failed to update settings in database: %v", err)
	}

	// Update in Drive async
	if sess.AccessToken != "" {
		token := &oauth2.Token{
			AccessToken:  sess.AccessToken,
			RefreshToken: sess.RefreshToken,
			Expiry:       sess.TokenExpiry,
		}

		go func() {
			driveService, err := drive.NewService(context.Background(), token, sess.UserID)
			if err == nil {
				driveService.UpdateSettings(settings)
			}
		}()
	}

	sess.Settings = settings
	session.Update(sessionID, sess)

	return c.JSON(fiber.Map{"success": true})
}

func SyncFromDrive(c *fiber.Ctx) error {
	sessionID := c.Cookies("session_id")
	sess, err := session.Get(sessionID)
	if err != nil || sess == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	if syncWorker == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Sync worker not available",
		})
	}

	token := &oauth2.Token{
		AccessToken:  sess.AccessToken,
		RefreshToken: sess.RefreshToken,
		Expiry:       sess.TokenExpiry,
	}

	// Import data from Drive
	go func() {
		log.Printf("Manual sync triggered for user %s", sess.UserID)
		if err := syncWorker.ImportFromDrive(sess.UserID, token); err != nil {
			log.Printf("Failed to import from Drive: %v", err)
		} else {
			log.Printf("Successfully imported data from Drive for user %s", sess.UserID)
		}
	}()

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Sync started in background",
	})
}
