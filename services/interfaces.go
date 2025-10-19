package services

import (
	"context"
	"daily-notes/database"
	"daily-notes/models"
	"daily-notes/storage/drive"
	"time"

	"golang.org/x/oauth2"
)

// NoteRepository defines the interface for note data access
type NoteRepository interface {
	GetNote(userID, contextName, date string) (*models.Note, error)
	UpsertNote(note *models.Note, syncPending bool) error
	DeleteNote(userID, contextName, date string) error
	GetNotesByContext(userID, contextName string, limit, offset int) ([]models.Note, error)
	GetFailedSyncNotes(userID string, limit int) ([]models.Note, error)
	GetPendingSyncNotes(limit int) ([]database.NoteWithMeta, error)
	RetrySyncNote(noteID string) error
}

// SyncWorker defines the interface for background sync operations
type SyncWorker interface {
	SyncNoteImmediate(userID, contextName, date string)
	ImportFromDrive(userID string, token *oauth2.Token) error
}

// ContextRepository defines the interface for context data access
type ContextRepository interface {
	GetContexts(userID string) ([]models.Context, error)
	GetContextByName(userID, name string) (*models.Context, error)
	GetContextByID(contextID string) (*models.Context, error)
	CreateContext(ctx *models.Context) error
	UpdateContext(contextID, name, color string) error
	UpdateNotesContextName(oldName, newName, userID string) error
	DeleteContext(contextID string) error
	GetNotesByContext(userID, contextName string, limit, offset int) ([]models.Note, error)
	DeleteNote(userID, contextName, date string) error
}

// StorageService represents Google Drive service operations needed by services
// Interface for testability - production uses drive.Service
type StorageService interface {
	UpsertNote(contextName, date, content string) (*models.Note, error)
	DeleteNote(contextName, date string) error
	GetAllNotesInContext(contextName string) ([]models.Note, error)
	GetContexts() ([]models.Context, error)
	RenameContext(contextID, oldName, newName string) error
	DeleteContext(contextID, contextName string) error
	GetSettings() (models.UserSettings, error)
	GetConfig() (*drive.Config, error)
	GetCurrentToken() (*oauth2.Token, error)
	CleanupOldDeletedFolders() error
}

// StorageFactory creates Drive service instances
type StorageFactory func(ctx context.Context, token *oauth2.Token, userID string) (StorageService, error)

// SessionStore defines the interface for session management
type SessionStore interface {
	Create(userID, email, name, picture, accessToken, refreshToken string, tokenExpiry time.Time, settings models.UserSettings) (*models.Session, error)
	Get(sessionID string) (*models.Session, error)
	Delete(sessionID string) error
}

// AuthRepository defines the interface for auth-related data access
type AuthRepository interface {
	UpsertUser(user *models.User) error
	GetContexts(userID string) ([]models.Context, error)
}
