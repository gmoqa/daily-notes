package drive

import (
	"daily-notes/models"
	"errors"
	"fmt"
	"strings"
	"time"
)

// NoteManager handles note-specific operations
type NoteManager struct {
	client        *Client
	folderManager *FolderManager
	fileManager   *FileManager
}

// NewNoteManager creates a new note manager
func NewNoteManager(client *Client, folderMgr *FolderManager, fileMgr *FileManager) *NoteManager {
	return &NoteManager{
		client:        client,
		folderManager: folderMgr,
		fileManager:   fileMgr,
	}
}

// Get retrieves a note from Drive
func (nm *NoteManager) Get(contextName, date string) (*models.Note, error) {
	// Get folder structure
	rootFolderID, err := nm.folderManager.GetRootFolder()
	if err != nil {
		return nil, err
	}

	contextFolderID, err := nm.folderManager.GetOrCreate(contextName, rootFolderID)
	if err != nil {
		return nil, err
	}

	// Find note file
	filename := dateToFilename(date)
	file, err := nm.fileManager.Find(filename, contextFolderID)
	if err != nil {
		return nil, err
	}

	// Note doesn't exist
	if file == nil {
		return nil, nil
	}

	// Download content
	contentBytes, err := nm.fileManager.Download(file.Id)
	if err != nil {
		return nil, err
	}

	createdAt, _ := time.Parse(time.RFC3339, file.CreatedTime)
	updatedAt, _ := time.Parse(time.RFC3339, file.ModifiedTime)

	return &models.Note{
		ID:        file.Id,
		UserID:    nm.client.UserID(),
		Context:   contextName,
		Date:      date,
		Content:   string(contentBytes),
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

// Upsert creates or updates a note
func (nm *NoteManager) Upsert(contextName, date, content string) (*models.Note, error) {
	// Get folder structure
	rootFolderID, err := nm.folderManager.GetRootFolder()
	if err != nil {
		return nil, err
	}

	contextFolderID, err := nm.folderManager.GetOrCreate(contextName, rootFolderID)
	if err != nil {
		return nil, err
	}

	filename := dateToFilename(date)
	reader := strings.NewReader(content)
	now := time.Now()

	// Check if file exists
	existingFile, err := nm.fileManager.Find(filename, contextFolderID)
	if err != nil {
		return nil, err
	}

	var fileID string
	var createdAt time.Time

	if existingFile != nil {
		// Update existing file
		fileID = existingFile.Id
		createdAt, _ = time.Parse(time.RFC3339, existingFile.CreatedTime)

		if err := nm.fileManager.Update(fileID, reader); err != nil {
			return nil, err
		}
	} else {
		// Create new file
		file, err := nm.fileManager.Create(filename, contextFolderID, "text/markdown", reader)
		if err != nil {
			return nil, err
		}

		fileID = file.Id
		createdAt, _ = time.Parse(time.RFC3339, file.CreatedTime)
	}

	return &models.Note{
		ID:        fileID,
		UserID:    nm.client.UserID(),
		Context:   contextName,
		Date:      date,
		Content:   content,
		CreatedAt: createdAt,
		UpdatedAt: now,
	}, nil
}

// Delete removes a note from Drive
func (nm *NoteManager) Delete(contextName, date string) error {
	rootFolderID, err := nm.folderManager.GetRootFolder()
	if err != nil {
		return err
	}

	contextFolderID, err := nm.folderManager.GetOrCreate(contextName, rootFolderID)
	if err != nil {
		return err
	}

	filename := dateToFilename(date)
	file, err := nm.fileManager.Find(filename, contextFolderID)
	if err != nil {
		return err
	}

	// File not found - not an error
	if file == nil {
		return nil
	}

	return nm.fileManager.Delete(file.Id)
}

// ListByContext retrieves all notes in a context (without content for performance)
func (nm *NoteManager) ListByContext(contextName string, limit, offset int) ([]models.Note, error) {
	rootFolderID, err := nm.folderManager.GetRootFolder()
	if err != nil {
		return nil, err
	}

	contextFolderID, err := nm.folderManager.GetOrCreate(contextName, rootFolderID)
	if err != nil {
		return nil, err
	}

	// List all .md files
	files, err := nm.fileManager.ListInFolder(contextFolderID, ".md", "modifiedTime desc", limit+offset)
	if err != nil {
		return nil, err
	}

	var allNotes []models.Note
	for _, file := range files {
		date, err := filenameToDate(file.Name)
		if err != nil {
			continue // Skip invalid filenames
		}

		createdAt, _ := time.Parse(time.RFC3339, file.CreatedTime)
		updatedAt, _ := time.Parse(time.RFC3339, file.ModifiedTime)

		allNotes = append(allNotes, models.Note{
			ID:        file.Id,
			UserID:    nm.client.UserID(),
			Context:   contextName,
			Date:      date,
			Content:   "", // Don't load content for list view
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

// GetAllInContext retrieves all notes with content in a context (for initial sync)
func (nm *NoteManager) GetAllInContext(contextName string) ([]models.Note, error) {
	rootFolderID, err := nm.folderManager.GetRootFolder()
	if err != nil {
		return nil, err
	}

	contextFolderID, err := nm.folderManager.GetOrCreate(contextName, rootFolderID)
	if err != nil {
		return nil, err
	}

	// List all .md files
	files, err := nm.fileManager.ListInFolder(contextFolderID, ".md", "", 1000)
	if err != nil {
		return nil, err
	}

	var notes []models.Note
	for _, file := range files {
		date, err := filenameToDate(file.Name)
		if err != nil {
			continue
		}

		// Download content
		contentBytes, err := nm.fileManager.Download(file.Id)
		if err != nil {
			continue
		}

		createdAt, _ := time.Parse(time.RFC3339, file.CreatedTime)
		updatedAt, _ := time.Parse(time.RFC3339, file.ModifiedTime)

		notes = append(notes, models.Note{
			ID:        file.Id,
			UserID:    nm.client.UserID(),
			Context:   contextName,
			Date:      date,
			Content:   string(contentBytes),
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		})
	}

	return notes, nil
}

// dateToFilename converts YYYY-MM-DD to DD-MM-YYYY.md
func dateToFilename(date string) string {
	parts := strings.Split(date, "-")
	if len(parts) != 3 {
		return date + ".md" // fallback
	}
	return fmt.Sprintf("%s-%s-%s.md", parts[2], parts[1], parts[0])
}

// filenameToDate converts DD-MM-YYYY.md to YYYY-MM-DD
func filenameToDate(filename string) (string, error) {
	name := strings.TrimSuffix(filename, ".md")
	parts := strings.Split(name, "-")
	if len(parts) != 3 {
		return "", errors.New("invalid filename format")
	}
	return fmt.Sprintf("%s-%s-%s", parts[2], parts[1], parts[0]), nil
}
