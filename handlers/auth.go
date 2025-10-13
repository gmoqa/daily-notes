package handlers

import (
	"context"
	"daily-notes/config"
	"daily-notes/drive"
	"daily-notes/models"
	"daily-notes/session"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/oauth2"
)

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
		Theme:             req.Theme,
		WeekStart:         req.WeekStart,
		Timezone:          req.Timezone,
		DateFormat:        req.DateFormat,
		UniqueContextMode: req.UniqueContextMode,
	}

	if sess.AccessToken != "" {
		token := &oauth2.Token{
			AccessToken:  sess.AccessToken,
			RefreshToken: sess.RefreshToken,
			Expiry:       sess.TokenExpiry,
		}

		driveService, err := drive.NewService(context.Background(), token, sess.UserID)
		if err == nil {
			driveService.UpdateSettings(settings)
		}
	}

	sess.Settings = settings
	session.Update(sessionID, sess)

	return c.JSON(fiber.Map{"success": true})
}
