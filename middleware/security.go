package middleware

import "github.com/gofiber/fiber/v2"

func Security() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com https://www.gstatic.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; font-src 'self' data: https://fonts.gstatic.com;")
		return c.Next()
	}
}
