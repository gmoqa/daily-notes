package database

import (
	"daily-notes/models"
	"database/sql"
	"fmt"
)

// ==================== NOTE OPERATIONS ====================

// GetNote retrieves a single note by user, context, and date
func (r *Repository) GetNote(userID, context, date string) (*models.Note, error) {
	var note models.Note
	var syncStatus string
	var syncLastAttemptAt sql.NullTime
	var syncError sql.NullString

	err := r.db.QueryRow(`
		SELECT id, user_id, context, date, content, drive_file_id,
		       sync_status, sync_retry_count, sync_last_attempt_at, sync_error,
		       created_at, updated_at
		FROM notes
		WHERE user_id = ? AND context = ? AND date = ? AND deleted = 0
	`, userID, context, date).Scan(
		&note.ID, &note.UserID, &note.Context, &note.Date,
		&note.Content, &note.ID,
		&syncStatus, &note.SyncRetryCount, &syncLastAttemptAt, &syncError,
		&note.CreatedAt, &note.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	note.SyncStatus = models.SyncStatus(syncStatus)
	if syncLastAttemptAt.Valid {
		note.SyncLastAttemptAt = &syncLastAttemptAt.Time
	}
	if syncError.Valid {
		note.SyncError = syncError.String
	}

	return &note, nil
}

// UpsertNote creates or updates a note
// markForSync: if true, marks the note as pending sync
func (r *Repository) UpsertNote(note *models.Note, markForSync bool) error {
	syncPending := 0
	syncStatus := string(models.SyncStatusSynced)
	if markForSync {
		syncPending = 1
		syncStatus = string(models.SyncStatusPending)
	}

	id := fmt.Sprintf("%s-%s-%s", note.UserID, note.Context, note.Date)
	if note.ID == "" {
		note.ID = id
	}

	_, err := r.db.Exec(`
		INSERT INTO notes (id, user_id, context, date, content, drive_file_id,
			sync_pending, sync_status, sync_retry_count, deleted, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
		ON CONFLICT(user_id, context, date) DO UPDATE SET
			content = CASE WHEN notes.deleted = 0 THEN excluded.content ELSE notes.content END,
			sync_pending = CASE WHEN notes.deleted = 0 THEN excluded.sync_pending ELSE notes.sync_pending END,
			sync_status = CASE WHEN notes.deleted = 0 THEN excluded.sync_status ELSE notes.sync_status END,
			sync_retry_count = CASE WHEN notes.deleted = 0 THEN 0 ELSE notes.sync_retry_count END,
			sync_error = CASE WHEN notes.deleted = 0 THEN NULL ELSE notes.sync_error END,
			updated_at = CASE WHEN notes.deleted = 0 THEN excluded.updated_at ELSE notes.updated_at END
	`,
		id, note.UserID, note.Context, note.Date, note.Content,
		note.ID, syncPending, syncStatus, note.CreatedAt, note.UpdatedAt,
	)
	return err
}

// GetNotesByContext retrieves all notes for a context (paginated)
func (r *Repository) GetNotesByContext(userID, context string, limit, offset int) ([]models.Note, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content, created_at, updated_at
		FROM notes
		WHERE user_id = ? AND context = ? AND deleted = 0
		ORDER BY date DESC
		LIMIT ? OFFSET ?
	`, userID, context, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []models.Note
	for rows.Next() {
		var note models.Note
		if err := rows.Scan(
			&note.ID, &note.UserID, &note.Context, &note.Date,
			&note.Content, &note.CreatedAt, &note.UpdatedAt,
		); err != nil {
			return nil, err
		}
		// Don't load content for list view (performance optimization)
		note.Content = ""
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

// GetAllNotesByUser retrieves all notes for a user
func (r *Repository) GetAllNotesByUser(userID string) ([]models.Note, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content, created_at, updated_at
		FROM notes
		WHERE user_id = ? AND deleted = 0
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []models.Note
	for rows.Next() {
		var note models.Note
		if err := rows.Scan(
			&note.ID, &note.UserID, &note.Context, &note.Date,
			&note.Content, &note.CreatedAt, &note.UpdatedAt,
		); err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

// DeleteNote marks a note as deleted and pending sync
// It doesn't actually delete the note - that's done after Drive deletion
func (r *Repository) DeleteNote(userID, context, date string) error {
	_, err := r.db.Exec(`
		UPDATE notes
		SET deleted = 1, sync_pending = 1, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = ? AND context = ? AND date = ?
	`, userID, context, date)
	return err
}

// HardDeleteNote permanently removes a note from the database
// Only called after successful Drive deletion
func (r *Repository) HardDeleteNote(userID, context, date string) error {
	_, err := r.db.Exec(`
		DELETE FROM notes
		WHERE user_id = ? AND context = ? AND date = ?
	`, userID, context, date)
	return err
}
