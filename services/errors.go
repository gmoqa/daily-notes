package services

import "errors"

// Common service-level errors
var (
	// Auth errors
	ErrInvalidAuthCode    = errors.New("invalid authorization code")
	ErrInvalidToken       = errors.New("invalid token")
	ErrInvalidUserInfo    = errors.New("invalid user information")
	ErrSessionNotFound    = errors.New("session not found")
	ErrUnauthorized       = errors.New("unauthorized access")
	ErrNoRefreshToken     = errors.New("no refresh token available")
	ErrTokenRefreshFailed = errors.New("failed to refresh access token")

	// Context errors
	ErrContextNotFound      = errors.New("context not found")
	ErrContextAlreadyExists = errors.New("context already exists")

	// Note errors
	ErrNoteNotFound = errors.New("note not found")
)
