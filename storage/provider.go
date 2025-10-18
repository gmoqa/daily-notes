package storage

import (
	"context"
	"daily-notes/models"

	"golang.org/x/oauth2"
)

// Provider is the interface for all cloud storage backends
// It abstracts operations on notes, contexts, settings, and config
type Provider interface {
	// ==================== NOTE OPERATIONS ====================

	// UpsertNote creates or updates a note in storage
	UpsertNote(contextName, date, content string) (*models.Note, error)

	// DeleteNote removes a note from storage
	DeleteNote(contextName, date string) error

	// GetAllNotesInContext retrieves all notes with content in a context (for initial sync)
	GetAllNotesInContext(contextName string) ([]models.Note, error)

	// ==================== CONTEXT OPERATIONS ====================

	// GetContexts returns all contexts from config
	GetContexts() ([]models.Context, error)

	// RenameContext updates a context's name in storage
	RenameContext(contextID, oldName, newName string) error

	// DeleteContext removes a context from storage
	DeleteContext(contextID, contextName string) error

	// ==================== SETTINGS OPERATIONS ====================

	// GetSettings returns user settings from storage
	GetSettings() (models.UserSettings, error)

	// ==================== CONFIG OPERATIONS ====================

	// GetConfig retrieves the full config from storage
	GetConfig() (*Config, error)

	// ==================== UTILITY OPERATIONS ====================

	// GetCurrentToken returns the current (possibly refreshed) OAuth token
	GetCurrentToken() (*oauth2.Token, error)

	// CleanupOldDeletedFolders removes old folders from _DELETED
	CleanupOldDeletedFolders() error
}

// Config represents the user's configuration stored in cloud storage
type Config struct {
	Contexts []models.Context      `json:"contexts"`
	Settings models.UserSettings   `json:"settings"`
}

// Factory is a function that creates a new storage provider instance
type Factory func(ctx context.Context, token *oauth2.Token, userID string) (Provider, error)
