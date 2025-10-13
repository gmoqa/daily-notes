package middleware

import (
	"context"
	"daily-notes/config"
	"daily-notes/session"
	"strings"

	"github.com/gofiber/fiber/v2"
	"google.golang.org/api/idtoken"
)

func AuthRequired() fiber.Handler {
	return func(c *fiber.Ctx) error {
		sessionID := c.Cookies("session_id")
		if sessionID != "" {
			sess, err := session.Get(sessionID)
			if err == nil && sess != nil {
				c.Locals("userID", sess.UserID)
				c.Locals("userEmail", sess.Email)
				c.Locals("session", sess)
				return c.Next()
			}
			c.ClearCookie("session_id")
		}

		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Missing authorization",
			})
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Invalid authorization header format",
			})
		}

		token := parts[1]

		payload, err := idtoken.Validate(context.Background(), token, config.AppConfig.GoogleClientID)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Invalid or expired token",
			})
		}

		c.Locals("userID", payload.Subject)
		c.Locals("userEmail", payload.Claims["email"])

		return c.Next()
	}
}

func GetUserID(c *fiber.Ctx) string {
	userID, ok := c.Locals("userID").(string)
	if !ok {
		return ""
	}
	return userID
}

func GetUserEmail(c *fiber.Ctx) string {
	email, ok := c.Locals("userEmail").(string)
	if !ok {
		return ""
	}
	return email
}
