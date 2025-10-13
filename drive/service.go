package drive

import (
	"context"
	"daily-notes/models"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type Service struct {
	client *drive.Service
	userID string
}

type Config struct {
	Contexts []models.Context     `json:"contexts"`
	Settings models.UserSettings `json:"settings"`
}

func NewService(ctx context.Context, token *oauth2.Token, userID string) (*Service, error) {
	config := &oauth2.Config{
		Scopes: []string{drive.DriveFileScope},
	}

	client := config.Client(ctx, token)
	srv, err := drive.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, err
	}

	return &Service{
		client: srv,
		userID: userID,
	}, nil
}

func (s *Service) getOrCreateFolder(name string, parentID string) (string, error) {
	query := fmt.Sprintf("name='%s' and mimeType='application/vnd.google-apps.folder' and trashed=false", name)
	if parentID != "" {
		query += fmt.Sprintf(" and '%s' in parents", parentID)
	}

	fileList, err := s.client.Files.List().Q(query).Fields("files(id, name)").Do()
	if err != nil {
		return "", err
	}

	if len(fileList.Files) > 0 {
		return fileList.Files[0].Id, nil
	}

	fileMetadata := &drive.File{
		Name:     name,
		MimeType: "application/vnd.google-apps.folder",
	}
	if parentID != "" {
		fileMetadata.Parents = []string{parentID}
	}

	file, err := s.client.Files.Create(fileMetadata).Fields("id").Do()
	if err != nil {
		return "", err
	}

	return file.Id, nil
}

func (s *Service) GetConfig() (*Config, error) {
	rootFolderID, err := s.getOrCreateFolder("daily-notes", "")
	if err != nil {
		return nil, err
	}

	query := fmt.Sprintf("name='config.json' and '%s' in parents and trashed=false", rootFolderID)
	fileList, err := s.client.Files.List().Q(query).Fields("files(id)").Do()
	if err != nil {
		return nil, err
	}

	if len(fileList.Files) == 0 {
		defaultConfig := &Config{
			Contexts: []models.Context{},
			Settings: models.UserSettings{
				Theme:     "dark",
				WeekStart: 0,
				Timezone:  "UTC",
			},
		}
		if err := s.SaveConfig(defaultConfig); err != nil {
			return nil, err
		}
		return defaultConfig, nil
	}

	resp, err := s.client.Files.Get(fileList.Files[0].Id).Download()
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var config Config
	if err := json.NewDecoder(resp.Body).Decode(&config); err != nil {
		return nil, err
	}

	return &config, nil
}

func (s *Service) SaveConfig(config *Config) error {
	rootFolderID, err := s.getOrCreateFolder("daily-notes", "")
	if err != nil {
		return err
	}

	query := fmt.Sprintf("name='config.json' and '%s' in parents and trashed=false", rootFolderID)
	fileList, err := s.client.Files.List().Q(query).Fields("files(id)").Do()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	reader := strings.NewReader(string(data))

	if len(fileList.Files) > 0 {
		_, err = s.client.Files.Update(fileList.Files[0].Id, &drive.File{}).Media(reader).Do()
		return err
	}

	fileMetadata := &drive.File{
		Name:     "config.json",
		Parents:  []string{rootFolderID},
		MimeType: "application/json",
	}

	_, err = s.client.Files.Create(fileMetadata).Media(reader).Do()
	return err
}

func (s *Service) GetContexts() ([]models.Context, error) {
	config, err := s.GetConfig()
	if err != nil {
		return nil, err
	}
	return config.Contexts, nil
}

func (s *Service) CreateContext(name, color string) (*models.Context, error) {
	config, err := s.GetConfig()
	if err != nil {
		return nil, err
	}

	for _, ctx := range config.Contexts {
		if ctx.Name == name {
			return nil, errors.New("context already exists")
		}
	}

	rootFolderID, err := s.getOrCreateFolder("daily-notes", "")
	if err != nil {
		return nil, err
	}

	contextFolderID, err := s.getOrCreateFolder(name, rootFolderID)
	if err != nil {
		return nil, err
	}

	newContext := models.Context{
		ID:        contextFolderID,
		UserID:    s.userID,
		Name:      name,
		Color:     color,
		CreatedAt: time.Now(),
	}

	config.Contexts = append(config.Contexts, newContext)
	if err := s.SaveConfig(config); err != nil {
		return nil, err
	}

	return &newContext, nil
}

func (s *Service) DeleteContext(contextID string) error {
	config, err := s.GetConfig()
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
	return s.SaveConfig(config)
}

func (s *Service) GetNote(contextName, date string) (*models.Note, error) {
	// Get or create folder structure: daily-notes/contextName/
	rootFolderID, err := s.getOrCreateFolder("daily-notes", "")
	if err != nil {
		return nil, err
	}

	contextFolderID, err := s.getOrCreateFolder(contextName, rootFolderID)
	if err != nil {
		return nil, err
	}

	// Convert date format from YYYY-MM-DD to DD-MM-YYYY for filename
	filename := s.dateToFilename(date)

	// Search for the markdown file
	query := fmt.Sprintf("name='%s' and '%s' in parents and trashed=false", filename, contextFolderID)
	fileList, err := s.client.Files.List().Q(query).Fields("files(id, createdTime, modifiedTime)").Do()
	if err != nil {
		return nil, err
	}

	// If file doesn't exist, return nil (empty note)
	if len(fileList.Files) == 0 {
		return nil, nil
	}

	// Download and read file content
	resp, err := s.client.Files.Get(fileList.Files[0].Id).Download()
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	contentBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	content := string(contentBytes)

	createdAt, _ := time.Parse(time.RFC3339, fileList.Files[0].CreatedTime)
	updatedAt, _ := time.Parse(time.RFC3339, fileList.Files[0].ModifiedTime)

	return &models.Note{
		ID:        fileList.Files[0].Id,
		UserID:    s.userID,
		Context:   contextName,
		Date:      date,
		Content:   content,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

func (s *Service) UpsertNote(contextName, date, content string) (*models.Note, error) {
	// Get or create folder structure: daily-notes/contextName/
	rootFolderID, err := s.getOrCreateFolder("daily-notes", "")
	if err != nil {
		return nil, err
	}

	contextFolderID, err := s.getOrCreateFolder(contextName, rootFolderID)
	if err != nil {
		return nil, err
	}

	// Convert date format from YYYY-MM-DD to DD-MM-YYYY for filename
	filename := s.dateToFilename(date)

	// Search for existing file
	query := fmt.Sprintf("name='%s' and '%s' in parents and trashed=false", filename, contextFolderID)
	fileList, err := s.client.Files.List().Q(query).Fields("files(id, createdTime, modifiedTime)").Do()
	if err != nil {
		return nil, err
	}

	reader := strings.NewReader(content)
	now := time.Now()

	var fileID string
	var createdAt time.Time

	if len(fileList.Files) > 0 {
		// Update existing file
		fileID = fileList.Files[0].Id
		createdAt, _ = time.Parse(time.RFC3339, fileList.Files[0].CreatedTime)

		_, err = s.client.Files.Update(fileID, &drive.File{}).Media(reader).Do()
		if err != nil {
			return nil, err
		}
	} else {
		// Create new file
		fileMetadata := &drive.File{
			Name:     filename,
			Parents:  []string{contextFolderID},
			MimeType: "text/markdown",
		}

		file, err := s.client.Files.Create(fileMetadata).Media(reader).Fields("id, createdTime").Do()
		if err != nil {
			return nil, err
		}

		fileID = file.Id
		createdAt, _ = time.Parse(time.RFC3339, file.CreatedTime)
	}

	return &models.Note{
		ID:        fileID,
		UserID:    s.userID,
		Context:   contextName,
		Date:      date,
		Content:   content,
		CreatedAt: createdAt,
		UpdatedAt: now,
	}, nil
}

func (s *Service) GetNotesByContext(contextName string, limit, offset int) ([]models.Note, error) {
	// Get or create folder structure: daily-notes/contextName/
	rootFolderID, err := s.getOrCreateFolder("daily-notes", "")
	if err != nil {
		return nil, err
	}

	contextFolderID, err := s.getOrCreateFolder(contextName, rootFolderID)
	if err != nil {
		return nil, err
	}

	// List all .md files in context folder, sorted by modifiedTime descending
	query := fmt.Sprintf("'%s' in parents and name contains '.md' and trashed=false", contextFolderID)
	fileList, err := s.client.Files.List().
		Q(query).
		Fields("files(id, name, createdTime, modifiedTime)").
		OrderBy("modifiedTime desc").
		PageSize(int64(limit + offset)).
		Do()
	if err != nil {
		return nil, err
	}

	allNotes := []models.Note{}
	for _, file := range fileList.Files {
		// Convert filename back to date (DD-MM-YYYY.md -> YYYY-MM-DD)
		date, err := s.filenameToDate(file.Name)
		if err != nil {
			continue // Skip invalid filenames
		}

		createdAt, _ := time.Parse(time.RFC3339, file.CreatedTime)
		updatedAt, _ := time.Parse(time.RFC3339, file.ModifiedTime)

		allNotes = append(allNotes, models.Note{
			ID:        file.Id,
			UserID:    s.userID,
			Context:   contextName,
			Date:      date,
			Content:   "", // Don't load content for list view (performance)
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		})
	}

	// Apply offset and limit
	if offset >= len(allNotes) {
		return []models.Note{}, nil
	}

	end := offset + limit
	if end > len(allNotes) {
		end = len(allNotes)
	}

	return allNotes[offset:end], nil
}

// dateToFilename converts YYYY-MM-DD to DD-MM-YYYY.md
func (s *Service) dateToFilename(date string) string {
	// date format: YYYY-MM-DD
	parts := strings.Split(date, "-")
	if len(parts) != 3 {
		return date + ".md" // fallback
	}
	// Return DD-MM-YYYY.md
	return fmt.Sprintf("%s-%s-%s.md", parts[2], parts[1], parts[0])
}

// filenameToDate converts DD-MM-YYYY.md to YYYY-MM-DD
func (s *Service) filenameToDate(filename string) (string, error) {
	// Remove .md extension
	name := strings.TrimSuffix(filename, ".md")

	// Split DD-MM-YYYY
	parts := strings.Split(name, "-")
	if len(parts) != 3 {
		return "", errors.New("invalid filename format")
	}

	// Return YYYY-MM-DD
	return fmt.Sprintf("%s-%s-%s", parts[2], parts[1], parts[0]), nil
}

func (s *Service) UpdateSettings(settings models.UserSettings) error {
	config, err := s.GetConfig()
	if err != nil {
		return err
	}

	config.Settings = settings
	return s.SaveConfig(config)
}

func (s *Service) GetSettings() (models.UserSettings, error) {
	config, err := s.GetConfig()
	if err != nil {
		return models.UserSettings{}, err
	}
	return config.Settings, nil
}
