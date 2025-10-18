package services

import (
	"context"
	"daily-notes/database"
	"daily-notes/models"
	"daily-notes/storage"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/oauth2"
)

// ContextService handles business logic for contexts
type ContextService struct {
	repo           *database.Repository
	storageFactory storage.Factory
}

// NewContextService creates a new context service
func NewContextService(repo *database.Repository, storageFactory storage.Factory) *ContextService {
	return &ContextService{
		repo:           repo,
		storageFactory: storageFactory,
	}
}

// List retrieves all contexts for a user
func (cs *ContextService) List(userID string) ([]models.Context, error) {
	return cs.repo.GetContexts(userID)
}

// Create creates a new context for a user
func (cs *ContextService) Create(userID, name, color string) (*models.Context, error) {
	// Trim whitespace
	name = strings.TrimSpace(name)

	// Set default color if not provided
	if color == "" {
		color = "primary"
	}

	// Check if context already exists
	existing, err := cs.repo.GetContextByName(userID, name)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrContextAlreadyExists
	}

	// Create in local database
	ctx := &models.Context{
		ID:        uuid.New().String(),
		UserID:    userID,
		Name:      name,
		Color:     color,
		CreatedAt: time.Now(),
	}

	if err := cs.repo.CreateContext(ctx); err != nil {
		return nil, err
	}

	return ctx, nil
}

// Update updates an existing context
func (cs *ContextService) Update(contextID, name, color string, userID string, token *oauth2.Token) error {
	// Trim whitespace
	name = strings.TrimSpace(name)

	// Set default color if not provided
	if color == "" {
		color = "primary"
	}

	// Get the old context to check if name is changing
	oldContext, err := cs.repo.GetContextByID(contextID)
	if err != nil {
		return err
	}
	if oldContext == nil {
		return ErrContextNotFound
	}

	// Check if name changed
	nameChanged := oldContext.Name != name

	// Update context in local database
	if err := cs.repo.UpdateContext(contextID, name, color); err != nil {
		return err
	}

	// If name changed, update all notes with the new context name
	if nameChanged {
		if err := cs.repo.UpdateNotesContextName(oldContext.Name, name, userID); err != nil {
			return err
		}

		// Also rename folder in Google Drive if token is provided
		if token != nil {
			go cs.renameDriveFolder(contextID, oldContext.Name, name, userID, token)
		}
	}

	return nil
}

// Delete deletes a context and its notes
func (cs *ContextService) Delete(contextID, userID string, token *oauth2.Token) error {
	// Get the context to retrieve its name
	ctx, err := cs.repo.GetContextByID(contextID)
	if err != nil {
		return err
	}
	if ctx == nil {
		return ErrContextNotFound
	}

	// Get all notes for this context and mark them as deleted
	notes, err := cs.repo.GetNotesByContext(userID, ctx.Name, 1000, 0)
	if err != nil {
		return err
	}

	// Mark all notes in this context as deleted (soft delete with sync pending)
	for _, note := range notes {
		// Ignore errors for individual notes, continue deleting others
		cs.repo.DeleteNote(userID, ctx.Name, note.Date)
	}

	// Delete from local database
	if err := cs.repo.DeleteContext(contextID); err != nil {
		return err
	}

	// Move folder to _DELETED in Google Drive (async)
	if token != nil {
		go cs.deleteDriveFolder(contextID, ctx.Name, userID, token)
	}

	return nil
}

// renameDriveFolder renames a folder in cloud storage (runs in background)
func (cs *ContextService) renameDriveFolder(contextID, oldName, newName, userID string, token *oauth2.Token) {
	provider, err := cs.storageFactory(context.Background(), token, userID)
	if err != nil {
		// Log error but don't fail - already updated locally
		return
	}

	if err := provider.RenameContext(contextID, oldName, newName); err != nil {
		// Log error but don't fail - already updated locally
		return
	}
}

// deleteDriveFolder moves a folder to _DELETED in cloud storage (runs in background)
func (cs *ContextService) deleteDriveFolder(contextID, contextName, userID string, token *oauth2.Token) {
	provider, err := cs.storageFactory(context.Background(), token, userID)
	if err != nil {
		// Log error but context is already deleted locally
		return
	}

	if err := provider.DeleteContext(contextID, contextName); err != nil {
		// Log error but context is already deleted locally
		return
	}
}
