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

	if req.AccessToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Access token is required",
		})
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

	googleID, _ := userInfo["sub"].(string)
	email, _ := userInfo["email"].(string)
	name, _ := userInfo["name"].(string)
	picture, _ := userInfo["picture"].(string)

	if googleID == "" || email == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid user information",
		})
	}

	// Use the access token directly from the frontend
	tokenExpiry := time.Now().Add(1 * time.Hour)
	if req.ExpiresIn > 0 {
		tokenExpiry = time.Now().Add(time.Duration(req.ExpiresIn) * time.Second)
	}

	token := &oauth2.Token{
		AccessToken:  req.AccessToken,
		RefreshToken: req.RefreshToken,
		Expiry:       tokenExpiry,
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

	// Save/update user in database
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
			"id":       sess.UserID,
			"email":    sess.Email,
			"name":     sess.Name,
			"picture":  sess.Picture,
			"settings": sess.Settings,
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
		Theme:              req.Theme,
		WeekStart:          req.WeekStart,
		Timezone:           req.Timezone,
		DateFormat:         req.DateFormat,
		UniqueContextMode:  req.UniqueContextMode,
		ShowBreadcrumb:     req.ShowBreadcrumb,
		ShowMarkdownEditor: req.ShowMarkdownEditor,
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
