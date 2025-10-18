package drive

import (
	"fmt"
	"io"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/googleapi"
)

// FileManager handles generic file operations in Google Drive
type FileManager struct {
	client *Client
}

// NewFileManager creates a new file manager
func NewFileManager(client *Client) *FileManager {
	return &FileManager{client: client}
}

// Find searches for a file by name in a specific folder
func (fm *FileManager) Find(filename, parentID string) (*drive.File, error) {
	query := fmt.Sprintf("name='%s' and '%s' in parents and trashed=false", filename, parentID)
	fileList, err := fm.client.Service().Files.List().
		Q(query).
		Fields("files(id, name, createdTime, modifiedTime)").
		Do()
	if err != nil {
		return nil, err
	}

	if len(fileList.Files) == 0 {
		return nil, nil
	}

	return fileList.Files[0], nil
}

// Download downloads the content of a file
func (fm *FileManager) Download(fileID string) ([]byte, error) {
	resp, err := fm.client.Service().Files.Get(fileID).Download()
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	return io.ReadAll(resp.Body)
}

// Create creates a new file with the given content
func (fm *FileManager) Create(name, parentID, mimeType string, content io.Reader) (*drive.File, error) {
	fileMetadata := &drive.File{
		Name:     name,
		Parents:  []string{parentID},
		MimeType: mimeType,
	}

	file, err := fm.client.Service().Files.Create(fileMetadata).
		Media(content).
		Fields("id, createdTime, modifiedTime").
		Do()
	if err != nil {
		return nil, err
	}

	return file, nil
}

// Update updates an existing file's content
func (fm *FileManager) Update(fileID string, content io.Reader) error {
	_, err := fm.client.Service().Files.Update(fileID, &drive.File{}).
		Media(content).
		Do()
	return err
}

// Delete moves a file to trash
func (fm *FileManager) Delete(fileID string) error {
	return fm.client.Service().Files.Delete(fileID).Do()
}

// List returns all files matching a query
func (fm *FileManager) List(query string, fields string, orderBy string, pageSize int64) ([]*drive.File, error) {
	call := fm.client.Service().Files.List().Q(query)

	if fields != "" {
		call.Fields(googleapi.Field(fields))
	}
	if orderBy != "" {
		call.OrderBy(orderBy)
	}
	if pageSize > 0 {
		call.PageSize(pageSize)
	}

	fileList, err := call.Do()
	if err != nil {
		return nil, err
	}

	return fileList.Files, nil
}

// ListInFolder returns all files in a specific folder
func (fm *FileManager) ListInFolder(parentID, pattern string, orderBy string, limit int) ([]*drive.File, error) {
	query := fmt.Sprintf("'%s' in parents and trashed=false", parentID)
	if pattern != "" {
		query += fmt.Sprintf(" and name contains '%s'", pattern)
	}

	fields := "files(id, name, createdTime, modifiedTime)"
	pageSize := int64(limit)
	if pageSize == 0 {
		pageSize = 100
	}

	return fm.List(query, fields, orderBy, pageSize)
}

// Rename renames a file
func (fm *FileManager) Rename(fileID, newName string) error {
	fileMetadata := &drive.File{
		Name: newName,
	}
	_, err := fm.client.Service().Files.Update(fileID, fileMetadata).Do()
	return err
}
