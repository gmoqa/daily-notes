package drive

import (
	"daily-notes/models"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Config represents the user's configuration stored in Drive
type Config struct {
	Contexts []models.Context    `json:"contexts"`
	Settings models.UserSettings `json:"settings"`
}

// ConfigManager handles configuration file operations
type ConfigManager struct {
	client        *Client
	folderManager *FolderManager
	fileManager   *FileManager
}

// NewConfigManager creates a new config manager
func NewConfigManager(client *Client, folderMgr *FolderManager, fileMgr *FileManager) *ConfigManager {
	return &ConfigManager{
		client:        client,
		folderManager: folderMgr,
		fileManager:   fileMgr,
	}
}

// Get retrieves the config from Drive, creating default if it doesn't exist
func (cm *ConfigManager) Get() (*Config, error) {
	rootFolderID, err := cm.folderManager.GetRootFolder()
	if err != nil {
		return nil, err
	}

	// Find config.json
	file, err := cm.fileManager.Find("config.json", rootFolderID)
	if err != nil {
		return nil, err
	}

	// Config doesn't exist - check for existing folders to migrate
	if file == nil {
		return cm.createDefaultConfig(rootFolderID)
	}

	// Download and parse config
	contentBytes, err := cm.fileManager.Download(file.Id)
	if err != nil {
		return nil, err
	}

	var config Config
	if err := json.Unmarshal(contentBytes, &config); err != nil {
		return nil, err
	}

	return &config, nil
}

// Save saves the config to Drive
func (cm *ConfigManager) Save(config *Config) error {
	rootFolderID, err := cm.folderManager.GetRootFolder()
	if err != nil {
		return err
	}

	// Marshal config to JSON
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	reader := strings.NewReader(string(data))

	// Check if config.json exists
	existingFile, err := cm.fileManager.Find("config.json", rootFolderID)
	if err != nil {
		return err
	}

	if existingFile != nil {
		// Update existing config
		return cm.fileManager.Update(existingFile.Id, reader)
	}

	// Create new config
	_, err = cm.fileManager.Create("config.json", rootFolderID, "application/json", reader)
	return err
}

// GetContexts returns all contexts from config
func (cm *ConfigManager) GetContexts() ([]models.Context, error) {
	config, err := cm.Get()
	if err != nil {
		return nil, err
	}
	return config.Contexts, nil
}

// CreateContext adds a new context to the config
func (cm *ConfigManager) CreateContext(name, color string) (*models.Context, error) {
	config, err := cm.Get()
	if err != nil {
		return nil, err
	}

	// Check if context already exists
	for _, ctx := range config.Contexts {
		if ctx.Name == name {
			return nil, errors.New("context already exists")
		}
	}

	// Create folder
	rootFolderID, err := cm.folderManager.GetRootFolder()
	if err != nil {
		return nil, err
	}

	contextFolderID, err := cm.folderManager.GetOrCreate(name, rootFolderID)
	if err != nil {
		return nil, err
	}

	// Add to config
	newContext := models.Context{
		ID:        contextFolderID,
		UserID:    cm.client.UserID(),
		Name:      name,
		Color:     color,
		CreatedAt: time.Now(),
	}

	config.Contexts = append(config.Contexts, newContext)
	if err := cm.Save(config); err != nil {
		return nil, err
	}

	return &newContext, nil
}

// RenameContext updates a context's name
func (cm *ConfigManager) RenameContext(contextID, oldName, newName string) error {
	config, err := cm.Get()
	if err != nil {
		return err
	}

	// Find and update context in config
	var found bool
	for i, ctx := range config.Contexts {
		if ctx.ID == contextID {
			config.Contexts[i].Name = newName
			found = true
			break
		}
	}

	if !found {
		return errors.New("context not found")
	}

	// Rename folder in Drive
	if err := cm.folderManager.Rename(contextID, newName); err != nil {
		return fmt.Errorf("failed to rename folder: %w", err)
	}

	// Save updated config
	if err := cm.Save(config); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

// DeleteContext removes a context from config and moves folder to _DELETED
func (cm *ConfigManager) DeleteContext(contextID, contextName string) error {
	// Get root folder
	rootFolderID, err := cm.folderManager.GetRootFolder()
	if err != nil {
		return err
	}

	// Create _DELETED folder
	deletedFolderID, err := cm.folderManager.GetOrCreate("_DELETED", rootFolderID)
	if err != nil {
		return err
	}

	// Move context folder to _DELETED with timestamp
	if contextID != "" {
		newName := fmt.Sprintf("%s_%s", contextName, time.Now().Format("20060102_150405"))
		if err := cm.folderManager.Rename(contextID, newName); err != nil {
			return fmt.Errorf("failed to rename folder: %w", err)
		}

		if err := cm.folderManager.Move(contextID, deletedFolderID, rootFolderID); err != nil {
			return fmt.Errorf("failed to move folder to _DELETED: %w", err)
		}
	}

	// Remove from config
	config, err := cm.Get()
	if err != nil {
		return err
	}

	newContexts := []models.Context{}
	for _, ctx := range config.Contexts {
		if ctx.ID != contextID {
			newContexts = append(newContexts, ctx)
		}
	}

	config.Contexts = newContexts
	return cm.Save(config)
}

// UpdateSettings updates user settings in config
func (cm *ConfigManager) UpdateSettings(settings models.UserSettings) error {
	config, err := cm.Get()
	if err != nil {
		return err
	}

	config.Settings = settings
	return cm.Save(config)
}

// GetSettings returns user settings from config
func (cm *ConfigManager) GetSettings() (models.UserSettings, error) {
	config, err := cm.Get()
	if err != nil {
		return models.UserSettings{}, err
	}
	return config.Settings, nil
}

// createDefaultConfig creates a default config, migrating existing folders if found
func (cm *ConfigManager) createDefaultConfig(rootFolderID string) (*Config, error) {
	// Check for existing context folders
	existingContexts, err := cm.detectExistingContexts(rootFolderID)
	if err == nil && len(existingContexts) > 0 {
		fmt.Printf("[Drive] Found %d existing context folders, migrating to config.json\n", len(existingContexts))
		defaultConfig := &Config{
			Contexts: existingContexts,
			Settings: cm.getDefaultSettings(),
		}
		if err := cm.Save(defaultConfig); err != nil {
			return nil, err
		}
		return defaultConfig, nil
	}

	// No existing contexts - create empty config
	defaultConfig := &Config{
		Contexts: []models.Context{},
		Settings: cm.getDefaultSettings(),
	}
	if err := cm.Save(defaultConfig); err != nil {
		return nil, err
	}
	return defaultConfig, nil
}

// detectExistingContexts scans for existing context folders
func (cm *ConfigManager) detectExistingContexts(rootFolderID string) ([]models.Context, error) {
	folders, err := cm.folderManager.List(rootFolderID)
	if err != nil {
		return nil, err
	}

	var contexts []models.Context
	for _, folder := range folders {
		createdAt, _ := time.Parse(time.RFC3339, folder.CreatedTime)
		contexts = append(contexts, models.Context{
			ID:        folder.Id,
			UserID:    cm.client.UserID(),
			Name:      folder.Name,
			Color:     "primary",
			CreatedAt: createdAt,
		})
	}

	return contexts, nil
}

// getDefaultSettings returns default user settings
func (cm *ConfigManager) getDefaultSettings() models.UserSettings {
	return models.UserSettings{
		Theme:      "dark",
		WeekStart:  0,
		Timezone:   "UTC",
		DateFormat: "DD-MM-YY",
	}
}

// IsFirstLogin checks if user has any data in Drive
func (cm *ConfigManager) IsFirstLogin() (bool, error) {
	// Check if dailynotes.dev folder exists
	exists, folderID, err := cm.folderManager.Exists("dailynotes.dev", "")
	if err != nil {
		return false, err
	}

	if !exists {
		return true, nil
	}

	// Check if config.json exists
	file, err := cm.fileManager.Find("config.json", folderID)
	if err != nil {
		return false, err
	}

	return file == nil, nil
}

// CleanupOldDeletedFolders removes folders from _DELETED older than 10 days
func (cm *ConfigManager) CleanupOldDeletedFolders() error {
	rootFolderID, err := cm.folderManager.GetRootFolder()
	if err != nil {
		return err
	}

	// Check if _DELETED exists
	exists, deletedFolderID, err := cm.folderManager.Exists("_DELETED", rootFolderID)
	if err != nil {
		return err
	}

	if !exists {
		return nil
	}

	// Get all folders in _DELETED
	folders, err := cm.folderManager.List(deletedFolderID)
	if err != nil {
		return err
	}

	// Delete folders older than 10 days
	cutoffTime := time.Now().AddDate(0, 0, -10)

	for _, folder := range folders {
		modifiedTime, err := time.Parse(time.RFC3339, folder.ModifiedTime)
		if err != nil {
			continue
		}

		if modifiedTime.Before(cutoffTime) {
			fmt.Printf("[Drive] Permanently deleting old folder: %s (modified: %s)\n", folder.Name, folder.ModifiedTime)
			if err := cm.folderManager.Delete(folder.Id); err != nil {
				fmt.Printf("[Drive] Failed to delete folder %s: %v\n", folder.Name, err)
				continue
			}
		}
	}

	return nil
}
