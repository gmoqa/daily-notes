package database

import (
	"daily-notes/models"
	"database/sql"
	"time"
)

// ==================== SYNC OPERATIONS ====================

// NoteWithMeta is an internal struct that includes sync metadata
// Used by the sync worker to get notes with their drive information
type NoteWithMeta struct {
	models.Note
	DriveFileID       string
	Deleted           bool
	SyncLastAttemptAt *time.Time
}

// GetPendingSyncNotes retrieves notes that need to be synced to Drive
func (r *Repository) GetPendingSyncNotes(limit int) ([]NoteWithMeta, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content, drive_file_id, deleted,
		       sync_last_attempt_at, created_at, updated_at
		FROM notes
		WHERE sync_pending = 1
		ORDER BY updated_at ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []NoteWithMeta
	for rows.Next() {
		var note NoteWithMeta
		var driveFileID sql.NullString
		var syncLastAttemptAt sql.NullTime
		var deleted int
		if err := rows.Scan(
			&note.ID, &note.UserID, &note.Context, &note.Date,
			&note.Content, &driveFileID, &deleted, &syncLastAttemptAt,
			&note.CreatedAt, &note.UpdatedAt,
		); err != nil {
			return nil, err
		}
		note.DriveFileID = driveFileID.String
		note.Deleted = deleted == 1
		if syncLastAttemptAt.Valid {
			note.SyncLastAttemptAt = &syncLastAttemptAt.Time
		}
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

// MarkNoteSynced marks a note as successfully synced to Drive
func (r *Repository) MarkNoteSynced(noteID, driveFileID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			drive_file_id = ?,
			sync_pending = 0,
			sync_status = ?,
			sync_retry_count = 0,
			sync_error = NULL,
			sync_last_attempt_at = ?,
			synced_at = ?
		WHERE id = ?
	`, driveFileID, string(models.SyncStatusSynced), time.Now(), time.Now(), noteID)
	return err
}

// MarkNoteSyncing marks a note as currently being synced
func (r *Repository) MarkNoteSyncing(noteID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			sync_status = ?,
			sync_last_attempt_at = ?
		WHERE id = ?
	`, string(models.SyncStatusSyncing), time.Now(), noteID)
	return err
}

// MarkNoteSyncFailed marks a note sync as failed and increments retry count
// Automatically abandons the note if max retries is reached
func (r *Repository) MarkNoteSyncFailed(noteID string, errorMsg string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			sync_status = CASE
				WHEN sync_retry_count + 1 >= ? THEN ?
				ELSE ?
			END,
			sync_retry_count = sync_retry_count + 1,
			sync_error = ?,
			sync_last_attempt_at = ?,
			sync_pending = CASE
				WHEN sync_retry_count + 1 >= ? THEN 0
				ELSE 1
			END
		WHERE id = ?
	`, models.MaxSyncRetries, string(models.SyncStatusAbandoned),
		string(models.SyncStatusFailed), errorMsg, time.Now(),
		models.MaxSyncRetries, noteID)
	return err
}

// MarkNoteAsNotPending marks a note as not pending sync
// Used to avoid infinite retry loops when sync is not possible
func (r *Repository) MarkNoteAsNotPending(noteID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			sync_pending = 0,
			sync_status = ?
		WHERE id = ?
	`, string(models.SyncStatusAbandoned), noteID)
	return err
}

// GetFailedSyncNotes returns notes that have failed sync
// Useful for admin/debugging and showing users which notes couldn't sync
func (r *Repository) GetFailedSyncNotes(userID string, limit int) ([]models.Note, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content,
		       sync_status, sync_retry_count, sync_last_attempt_at, sync_error,
		       created_at, updated_at
		FROM notes
		WHERE user_id = ? AND sync_status IN (?, ?)
		ORDER BY sync_last_attempt_at DESC
		LIMIT ?
	`, userID, string(models.SyncStatusFailed), string(models.SyncStatusAbandoned), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []models.Note
	for rows.Next() {
		var note models.Note
		var syncStatus string
		var syncLastAttemptAt sql.NullTime
		var syncError sql.NullString

		if err := rows.Scan(
			&note.ID, &note.UserID, &note.Context, &note.Date, &note.Content,
			&syncStatus, &note.SyncRetryCount, &syncLastAttemptAt, &syncError,
			&note.CreatedAt, &note.UpdatedAt,
		); err != nil {
			return nil, err
		}

		note.SyncStatus = models.SyncStatus(syncStatus)
		if syncLastAttemptAt.Valid {
			note.SyncLastAttemptAt = &syncLastAttemptAt.Time
		}
		if syncError.Valid {
			note.SyncError = syncError.String
		}

		notes = append(notes, note)
	}

	return notes, rows.Err()
}

// RetrySyncNote resets a failed note's sync status to retry synchronization
// Clears the error and retry count to give it a fresh start
func (r *Repository) RetrySyncNote(noteID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			sync_pending = 1,
			sync_status = ?,
			sync_retry_count = 0,
			sync_error = NULL
		WHERE id = ?
	`, string(models.SyncStatusPending), noteID)
	return err
}
