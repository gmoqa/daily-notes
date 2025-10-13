package handlers

import (
	"daily-notes/config"
	"daily-notes/session"
	"time"

	"github.com/gofiber/fiber/v2"
)

func HomePage(c *fiber.Ctx) error {
	var userID, userEmail, userName, userPicture string
	sessionID := c.Cookies("session_id")

	if sessionID != "" {
		sess, err := session.Get(sessionID)
		if err == nil && sess != nil {
			userID = sess.UserID
			userEmail = sess.Email
			userName = sess.Name
			userPicture = sess.Picture
		}
	}

	return c.Render("index", fiber.Map{
		"IsAuthenticated": userID != "",
		"UserID":          userID,
		"UserEmail":       userEmail,
		"UserName":        userName,
		"UserPicture":     userPicture,
		"GoogleClientID":  config.AppConfig.GoogleClientID,
	})
}

func ServerTime(c *fiber.Ctx) error {
	timezone := c.Query("timezone", "UTC")

	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}

	now := time.Now().In(loc)

	return c.JSON(fiber.Map{
		"timestamp": now.Unix(),
		"timezone":  timezone,
		"iso":       now.Format(time.RFC3339),
	})
}
