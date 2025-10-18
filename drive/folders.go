package drive

import (
	"fmt"

	"google.golang.org/api/drive/v3"
)

// FolderManager handles folder operations in Google Drive
type FolderManager struct {
	client *Client
}

// NewFolderManager creates a new folder manager
func NewFolderManager(client *Client) *FolderManager {
	return &FolderManager{client: client}
}

// GetOrCreate returns the ID of a folder, creating it if it doesn't exist
func (fm *FolderManager) GetOrCreate(name string, parentID string) (string, error) {
	// If no parent is specified, use "root" for the user's main Drive folder
	if parentID == "" {
		parentID = "root"
	}

	// Search for existing folder
	query := fmt.Sprintf("name='%s' and mimeType='application/vnd.google-apps.folder' and trashed=false and '%s' in parents", name, parentID)

	fileList, err := fm.client.Service().Files.List().
		Q(query).
		Fields("files(id, name)").
		Do()
	if err != nil {
		return "", err
	}

	// Return existing folder ID if found
	if len(fileList.Files) > 0 {
		return fileList.Files[0].Id, nil
	}

	// Create new folder
	fileMetadata := &drive.File{
		Name:     name,
		MimeType: "application/vnd.google-apps.folder",
		Parents:  []string{parentID},
	}

	file, err := fm.client.Service().Files.Create(fileMetadata).
		Fields("id").
		Do()
	if err != nil {
		return "", err
	}

	return file.Id, nil
}

// GetRootFolder returns the ID of the dailynotes.dev root folder, creating it if needed
func (fm *FolderManager) GetRootFolder() (string, error) {
	return fm.GetOrCreate("dailynotes.dev", "")
}

// Move moves a folder to a new parent
func (fm *FolderManager) Move(folderID, newParentID, oldParentID string) error {
	_, err := fm.client.Service().Files.Update(folderID, &drive.File{}).
		AddParents(newParentID).
		RemoveParents(oldParentID).
		Do()
	return err
}

// Rename renames a folder
func (fm *FolderManager) Rename(folderID, newName string) error {
	fileMetadata := &drive.File{
		Name: newName,
	}
	_, err := fm.client.Service().Files.Update(folderID, fileMetadata).Do()
	return err
}

// List returns all folders in a parent folder
func (fm *FolderManager) List(parentID string) ([]*drive.File, error) {
	query := fmt.Sprintf("'%s' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", parentID)
	fileList, err := fm.client.Service().Files.List().
		Q(query).
		Fields("files(id, name, createdTime, modifiedTime)").
		Do()
	if err != nil {
		return nil, err
	}
	return fileList.Files, nil
}

// Delete permanently deletes a folder
func (fm *FolderManager) Delete(folderID string) error {
	return fm.client.Service().Files.Delete(folderID).Do()
}

// Exists checks if a folder with the given name exists in the parent
func (fm *FolderManager) Exists(name, parentID string) (bool, string, error) {
	if parentID == "" {
		parentID = "root"
	}

	query := fmt.Sprintf("name='%s' and mimeType='application/vnd.google-apps.folder' and trashed=false and '%s' in parents", name, parentID)
	fileList, err := fm.client.Service().Files.List().
		Q(query).
		Fields("files(id)").
		Do()
	if err != nil {
		return false, "", err
	}

	if len(fileList.Files) > 0 {
		return true, fileList.Files[0].Id, nil
	}

	return false, "", nil
}
