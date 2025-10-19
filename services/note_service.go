package services

import (
	"daily-notes/models"
	"time"
)

// NoteService handles business logic for notes
type NoteService struct {
	repo       NoteRepository
	syncWorker SyncWorker
}

// NewNoteService creates a new note service
func NewNoteService(repo NoteRepository, syncWorker SyncWorker) *NoteService {
	return &NoteService{
		repo:       repo,
		syncWorker: syncWorker,
	}
}

// Get retrieves a note for a specific context and date
func (ns *NoteService) Get(userID, contextName, date string) (*models.Note, error) {
	note, err := ns.repo.GetNote(userID, contextName, date)
	if err != nil {
		return nil, err
	}

	// If note doesn't exist, return empty note structure
	if note == nil {
		return &models.Note{
			UserID:  userID,
			Context: contextName,
			Date:    date,
			Content: "",
		}, nil
	}

	return note, nil
}

// Upsert creates or updates a note
func (ns *NoteService) Upsert(userID, contextName, date, content string) (*models.Note, error) {
	note := &models.Note{
		UserID:    userID,
		Context:   contextName,
		Date:      date,
		Content:   content,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Save to local database immediately (fast response)
	// Mark for sync with Drive (sync_pending = true)
	if err := ns.repo.UpsertNote(note, true); err != nil {
		return nil, err
	}

	// Trigger immediate sync in background (non-blocking)
	if ns.syncWorker != nil {
		ns.syncWorker.SyncNoteImmediate(userID, contextName, date)
	}

	return note, nil
}

// Delete marks a note as deleted
func (ns *NoteService) Delete(userID, contextName, date string) error {
	// Mark note as deleted (will be synced by background worker)
	return ns.repo.DeleteNote(userID, contextName, date)
}

// ListByContext retrieves all notes for a specific context with pagination
func (ns *NoteService) ListByContext(userID, contextName string, limit, offset int) ([]models.Note, error) {
	// Validate and normalize pagination params
	if limit < 1 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}

	return ns.repo.GetNotesByContext(userID, contextName, limit, offset)
}

// GetSyncStatus returns sync status information for the user
func (ns *NoteService) GetSyncStatus(userID string) (map[string]interface{}, error) {
	// Get failed sync notes (up to 50)
	failedNotes, err := ns.repo.GetFailedSyncNotes(userID, 50)
	if err != nil {
		return nil, err
	}

	// Get pending sync notes count
	pendingNotes, err := ns.repo.GetPendingSyncNotes(50)
	if err != nil {
		return nil, err
	}

	// Count only this user's pending notes
	userPendingCount := 0
	for _, note := range pendingNotes {
		if note.UserID == userID {
			userPendingCount++
		}
	}

	return map[string]interface{}{
		"pending_count": userPendingCount,
		"failed_count":  len(failedNotes),
		"failed_notes":  failedNotes,
	}, nil
}

// RetrySync retries synchronization for a failed note
func (ns *NoteService) RetrySync(noteID, userID string) error {
	// Verify the note belongs to this user by parsing the note ID
	// Note IDs follow the format: userID-context-date
	if len(noteID) < len(userID)+2 || noteID[:len(userID)+1] != userID+"-" {
		return ErrUnauthorized
	}

	// Reset the note's sync status to retry
	return ns.repo.RetrySyncNote(noteID)
}
