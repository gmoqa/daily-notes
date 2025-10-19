package drive

import (
	"context"
	"daily-notes/models"

	"golang.org/x/oauth2"
)

// Service is the main coordinator for all Drive operations
// It delegates to specialized managers for different concerns
type Service struct {
	client        *Client
	folderManager *FolderManager
	fileManager   *FileManager
	noteManager   *NoteManager
	configManager *ConfigManager
}

// NewService creates a new Drive service with all managers initialized
func NewService(ctx context.Context, token *oauth2.Token, userID string) (*Service, error) {
	// Create client
	client, err := NewClient(ctx, token, userID)
	if err != nil {
		return nil, err
	}

	// Create managers
	folderMgr := NewFolderManager(client)
	fileMgr := NewFileManager(client)
	noteMgr := NewNoteManager(client, folderMgr, fileMgr)
	configMgr := NewConfigManager(client, folderMgr, fileMgr)

	return &Service{
		client:        client,
		folderManager: folderMgr,
		fileManager:   fileMgr,
		noteManager:   noteMgr,
		configManager: configMgr,
	}, nil
}

// GetCurrentToken returns the current (possibly refreshed) OAuth token
func (s *Service) GetCurrentToken() (*oauth2.Token, error) {
	return s.client.GetCurrentToken()
}

// ==================== NOTE OPERATIONS ====================

// GetNote retrieves a note from Drive
func (s *Service) GetNote(contextName, date string) (*models.Note, error) {
	return s.noteManager.Get(contextName, date)
}

// UpsertNote creates or updates a note in Drive
func (s *Service) UpsertNote(contextName, date, content string) (*models.Note, error) {
	return s.noteManager.Upsert(contextName, date, content)
}

// DeleteNote removes a note from Drive
func (s *Service) DeleteNote(contextName, date string) error {
	return s.noteManager.Delete(contextName, date)
}

// GetNotesByContext retrieves all notes in a context (without content)
func (s *Service) GetNotesByContext(contextName string, limit, offset int) ([]models.Note, error) {
	return s.noteManager.ListByContext(contextName, limit, offset)
}

// GetAllNotesInContext retrieves all notes with content in a context (for initial sync)
func (s *Service) GetAllNotesInContext(contextName string) ([]models.Note, error) {
	return s.noteManager.GetAllInContext(contextName)
}

// ==================== CONTEXT OPERATIONS ====================

// GetContexts returns all contexts from config
func (s *Service) GetContexts() ([]models.Context, error) {
	return s.configManager.GetContexts()
}

// CreateContext adds a new context
func (s *Service) CreateContext(name, color string) (*models.Context, error) {
	return s.configManager.CreateContext(name, color)
}

// RenameContext updates a context's name
func (s *Service) RenameContext(contextID, oldName, newName string) error {
	return s.configManager.RenameContext(contextID, oldName, newName)
}

// DeleteContext removes a context
func (s *Service) DeleteContext(contextID, contextName string) error {
	return s.configManager.DeleteContext(contextID, contextName)
}

// ==================== SETTINGS OPERATIONS ====================

// UpdateSettings updates user settings
func (s *Service) UpdateSettings(settings models.UserSettings) error {
	return s.configManager.UpdateSettings(settings)
}

// GetSettings returns user settings
func (s *Service) GetSettings() (models.UserSettings, error) {
	return s.configManager.GetSettings()
}

// ==================== CONFIG OPERATIONS ====================

// GetConfig retrieves the full config from Drive
func (s *Service) GetConfig() (*Config, error) {
	return s.configManager.Get()
}

// SaveConfig saves the config to Drive
func (s *Service) SaveConfig(config *Config) error {
	return s.configManager.Save(config)
}

// ==================== UTILITY OPERATIONS ====================

// IsFirstLogin checks if user has any data in Drive
func (s *Service) IsFirstLogin() (bool, error) {
	return s.configManager.IsFirstLogin()
}

// CleanupOldDeletedFolders removes old folders from _DELETED
func (s *Service) CleanupOldDeletedFolders() error {
	return s.configManager.CleanupOldDeletedFolders()
}
