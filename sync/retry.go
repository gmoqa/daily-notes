package sync

import (
	"daily-notes/database"
	"log"
	"strings"
	"time"
)

// ==================== RETRY LOGIC & BACKOFF ====================

// syncResult holds the result of a sync operation
type syncResult struct {
	syncedCount  int
	failedCount  int
	tokenExpired bool
}

// filterOldNotes filters notes that are older than the specified duration
// This prevents race conditions with immediate sync by only processing notes
// that haven't been recently modified
func filterOldNotes(notes []database.NoteWithMeta, minAge time.Duration) []database.NoteWithMeta {
	var oldNotes []database.NoteWithMeta
	now := time.Now()

	for _, note := range notes {
		if note.SyncLastAttemptAt != nil {
			// Check last attempt time
			if now.Sub(*note.SyncLastAttemptAt) >= minAge {
				oldNotes = append(oldNotes, note)
			}
		} else {
			// No previous attempt, check creation time
			if now.Sub(note.UpdatedAt) >= minAge {
				oldNotes = append(oldNotes, note)
			}
		}
	}

	return oldNotes
}

// isTokenExpiredError checks if an error is related to token expiration
func isTokenExpiredError(err error) bool {
	if err == nil {
		return false
	}
	errMsg := err.Error()
	return strings.Contains(errMsg, "token expired") ||
		strings.Contains(errMsg, "Token has been expired") ||
		strings.Contains(errMsg, "invalid_grant") ||
		strings.Contains(errMsg, "401")
}

// markNotesAsFailed marks a batch of notes as failed with an error message
func (w *Worker) markNotesAsFailed(notes []database.NoteWithMeta, errorMsg string) {
	for _, note := range notes {
		if err := w.repo.MarkNoteSyncFailed(note.ID, errorMsg); err != nil {
			log.Printf("[Sync Worker] Failed to mark note %s as failed: %v", note.ID, err)
		}
	}
}
