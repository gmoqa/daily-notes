package sync

import (
	"context"
	"daily-notes/database"
	"fmt"
	"log"
	"time"
)

// ==================== SYNC EXECUTION ====================

// syncPendingNotes retrieves and syncs pending notes (batch mode with retry logic)
// Returns true if work was found, false otherwise
func (w *Worker) syncPendingNotes() bool {
	// Get batch of pending notes (only retry old ones to avoid race with immediate sync)
	notes, err := w.repo.GetPendingSyncNotes(50)
	if err != nil {
		log.Printf("[Sync Worker] Failed to get pending notes: %v", err)
		return false
	}

	if len(notes) == 0 {
		return false
	}

	// Filter notes older than 30 seconds (avoid race with immediate sync)
	oldNotes := filterOldNotes(notes, 30*time.Second)

	if len(oldNotes) == 0 {
		return false
	}

	log.Printf("[Sync Worker] Processing %d pending/failed notes for retry", len(oldNotes))

	// Group notes by user
	notesByUser := make(map[string][]database.NoteWithMeta)
	for _, note := range oldNotes {
		notesByUser[note.UserID] = append(notesByUser[note.UserID], note)
	}

	// Sync each user's notes
	for userID, userNotes := range notesByUser {
		w.syncUserNotes(userID, userNotes)
	}

	return true // Had work
}

// syncUserNotes syncs a batch of notes for a specific user
func (w *Worker) syncUserNotes(userID string, notes []database.NoteWithMeta) {
	result := w.syncNotesWithDrive(userID, notes, "Sync Worker")

	if result.syncedCount > 0 || result.failedCount > 0 {
		log.Printf("[Sync Worker] Sync complete for user %s: %d succeeded, %d failed out of %d total",
			userID, result.syncedCount, result.failedCount, len(notes))
	}
}

// syncNotesWithDrive is the unified sync logic for both immediate and batch sync
// It handles token retrieval, storage provider creation, note syncing, and token refresh
func (w *Worker) syncNotesWithDrive(userID string, notes []database.NoteWithMeta, logPrefix string) *syncResult {
	result := &syncResult{}

	// Get user's token
	token, err := w.getUserToken(userID)
	if err != nil {
		log.Printf("[%s] Failed to get token for user %s: %v", logPrefix, userID, err)
		w.markNotesAsFailed(notes, fmt.Sprintf("Failed to get authentication token: %v", err))
		result.failedCount = len(notes)
		return result
	}

	// Create storage provider
	provider, err := w.storageFactory(context.Background(), token, userID)
	if err != nil {
		log.Printf("[%s] Failed to create storage provider for user %s: %v", logPrefix, userID, err)
		w.markNotesAsFailed(notes, fmt.Sprintf("Failed to connect to cloud storage: %v", err))
		result.failedCount = len(notes)
		return result
	}

	// Separate delete operations and regular operations
	var deleteOps []database.NoteWithMeta
	var regularOps []database.NoteWithMeta
	for _, note := range notes {
		if note.Deleted {
			deleteOps = append(deleteOps, note)
		} else {
			regularOps = append(regularOps, note)
		}
	}

	// Process deletions first (higher priority)
	for _, note := range deleteOps {
		// Mark note as currently syncing
		if err := w.repo.MarkNoteSyncing(note.ID); err != nil {
			log.Printf("[%s] Failed to mark note as syncing: %v", logPrefix, err)
		}

		if err := w.syncNote(provider, &note); err != nil {
			// Check if it's a token expiration error
			if isTokenExpiredError(err) {
				log.Printf("[%s] Token expired for user %s, stopping sync", logPrefix, userID)
				result.tokenExpired = true
				w.repo.MarkNoteSyncFailed(note.ID, "Authentication token expired")
				result.failedCount++
				break
			}
			// Mark as failed with error message
			w.repo.MarkNoteSyncFailed(note.ID, fmt.Sprintf("Delete failed: %v", err))
			result.failedCount++
			continue
		}
		result.syncedCount++
	}

	// Then process regular operations (only if token is still valid)
	if !result.tokenExpired {
		for _, note := range regularOps {
			// Mark note as currently syncing
			if err := w.repo.MarkNoteSyncing(note.ID); err != nil {
				log.Printf("[%s] Failed to mark note as syncing: %v", logPrefix, err)
			}

			if err := w.syncNote(provider, &note); err != nil {
				// Check if it's a token expiration error
				if isTokenExpiredError(err) {
					log.Printf("[%s] Token expired for user %s, stopping sync", logPrefix, userID)
					result.tokenExpired = true
					w.repo.MarkNoteSyncFailed(note.ID, "Authentication token expired")
					result.failedCount++
					break
				}
				// Mark as failed with error message
				w.repo.MarkNoteSyncFailed(note.ID, fmt.Sprintf("Sync failed: %v", err))
				result.failedCount++
				continue
			}
			result.syncedCount++
		}
	}

	// If token expired, mark all remaining unprocessed notes as failed
	if result.tokenExpired {
		log.Printf("[%s] Marking remaining notes as failed due to expired token", logPrefix)
		errorMsg := "Authentication token expired, please sign in again"
		for _, note := range notes {
			w.repo.MarkNoteSyncFailed(note.ID, errorMsg)
		}
		return result
	}

	// Update the token in the session if it was refreshed
	w.updateTokenIfRefreshed(provider, token, userID, logPrefix)

	return result
}

// syncNote syncs a single note to cloud storage
func (w *Worker) syncNote(provider StorageService, note *database.NoteWithMeta) error {
	if note.Deleted {
		// Delete from storage
		if err := provider.DeleteNote(note.Context, note.Date); err != nil {
			return err
		}
		// Hard delete from database after successful deletion
		return w.repo.HardDeleteNote(note.UserID, note.Context, note.Date)
	}

	// Upload to storage
	syncedNote, err := provider.UpsertNote(note.Context, note.Date, note.Content)
	if err != nil {
		return err
	}

	// Mark as synced in database
	return w.repo.MarkNoteSynced(note.ID, syncedNote.ID)
}

// SyncNoteImmediate attempts to sync a single note immediately (non-blocking)
// This is called when a user saves a note for instant sync to Drive
func (w *Worker) SyncNoteImmediate(userID, noteContext, date string) {
	go func() {
		// Get the note from database
		note, err := w.repo.GetNote(userID, noteContext, date)
		if err != nil {
			log.Printf("[Immediate Sync] Failed to get note %s/%s: %v", noteContext, date, err)
			return
		}

		// Convert to NoteWithMeta for unified sync
		noteMeta := database.NoteWithMeta{
			Note: *note,
		}

		// Use unified sync logic
		result := w.syncNotesWithDrive(userID, []database.NoteWithMeta{noteMeta}, "Immediate Sync")

		// Log result
		if result.syncedCount > 0 {
			log.Printf("[Immediate Sync] Successfully synced note %s/%s", noteContext, date)
		} else if result.failedCount > 0 {
			log.Printf("[Immediate Sync] Failed to sync note %s/%s", noteContext, date)
		}
	}()
}
