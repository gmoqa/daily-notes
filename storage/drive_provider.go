package storage

import (
	"context"
	"daily-notes/drive"
	"daily-notes/models"

	"golang.org/x/oauth2"
)

// DriveProvider is an adapter that implements the Provider interface using Google Drive
type DriveProvider struct {
	service *drive.Service
}

// NewDriveProvider creates a new Drive storage provider
func NewDriveProvider(ctx context.Context, token *oauth2.Token, userID string) (Provider, error) {
	service, err := drive.NewService(ctx, token, userID)
	if err != nil {
		return nil, err
	}

	return &DriveProvider{
		service: service,
	}, nil
}

// ==================== NOTE OPERATIONS ====================

func (d *DriveProvider) UpsertNote(contextName, date, content string) (*models.Note, error) {
	return d.service.UpsertNote(contextName, date, content)
}

func (d *DriveProvider) DeleteNote(contextName, date string) error {
	return d.service.DeleteNote(contextName, date)
}

func (d *DriveProvider) GetAllNotesInContext(contextName string) ([]models.Note, error) {
	return d.service.GetAllNotesInContext(contextName)
}

// ==================== CONTEXT OPERATIONS ====================

func (d *DriveProvider) GetContexts() ([]models.Context, error) {
	return d.service.GetContexts()
}

func (d *DriveProvider) RenameContext(contextID, oldName, newName string) error {
	return d.service.RenameContext(contextID, oldName, newName)
}

func (d *DriveProvider) DeleteContext(contextID, contextName string) error {
	return d.service.DeleteContext(contextID, contextName)
}

// ==================== SETTINGS OPERATIONS ====================

func (d *DriveProvider) GetSettings() (models.UserSettings, error) {
	return d.service.GetSettings()
}

// ==================== CONFIG OPERATIONS ====================

func (d *DriveProvider) GetConfig() (*Config, error) {
	driveConfig, err := d.service.GetConfig()
	if err != nil {
		return nil, err
	}

	// Convert drive.Config to storage.Config
	return &Config{
		Contexts: driveConfig.Contexts,
		Settings: driveConfig.Settings,
	}, nil
}

// ==================== UTILITY OPERATIONS ====================

func (d *DriveProvider) GetCurrentToken() (*oauth2.Token, error) {
	return d.service.GetCurrentToken()
}

func (d *DriveProvider) CleanupOldDeletedFolders() error {
	return d.service.CleanupOldDeletedFolders()
}
