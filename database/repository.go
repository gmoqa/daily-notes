package database

import (
	"daily-notes/models"
	"database/sql"
	"fmt"
	"time"
)

type Repository struct {
	db *DB
}

func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}

// ==================== USERS ====================

func (r *Repository) GetUser(userID string) (*models.User, error) {
	var user models.User
	var settings models.UserSettings

	err := r.db.QueryRow(`
		SELECT id, google_id, email, name, picture,
			   settings_theme, settings_week_start, settings_timezone,
			   settings_date_format, settings_unique_context_mode,
			   created_at, last_login_at
		FROM users WHERE id = ?
	`, userID).Scan(
		&user.ID, &user.GoogleID, &user.Email, &user.Name, &user.Picture,
		&settings.Theme, &settings.WeekStart, &settings.Timezone,
		&settings.DateFormat, &settings.UniqueContextMode,
		&user.CreatedAt, &user.LastLoginAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	user.Settings = settings
	return &user, nil
}

func (r *Repository) UpsertUser(user *models.User) error {
	_, err := r.db.Exec(`
		INSERT INTO users (id, google_id, email, name, picture,
			settings_theme, settings_week_start, settings_timezone,
			settings_date_format, settings_unique_context_mode,
			created_at, last_login_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			email = excluded.email,
			name = excluded.name,
			picture = excluded.picture,
			last_login_at = excluded.last_login_at,
			updated_at = excluded.updated_at
	`,
		user.ID, user.GoogleID, user.Email, user.Name, user.Picture,
		user.Settings.Theme, user.Settings.WeekStart, user.Settings.Timezone,
		user.Settings.DateFormat, user.Settings.UniqueContextMode,
		user.CreatedAt, user.LastLoginAt, time.Now(),
	)
	return err
}

func (r *Repository) UpdateUserSettings(userID string, settings models.UserSettings) error {
	_, err := r.db.Exec(`
		UPDATE users SET
			settings_theme = ?,
			settings_week_start = ?,
			settings_timezone = ?,
			settings_date_format = ?,
			settings_unique_context_mode = ?,
			updated_at = ?
		WHERE id = ?
	`,
		settings.Theme, settings.WeekStart, settings.Timezone,
		settings.DateFormat, settings.UniqueContextMode,
		time.Now(), userID,
	)
	return err
}

// ==================== CONTEXTS ====================

func (r *Repository) GetContexts(userID string) ([]models.Context, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, name, color, created_at
		FROM contexts
		WHERE user_id = ?
		ORDER BY created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Initialize with empty slice to avoid returning nil
	contexts := make([]models.Context, 0)
	for rows.Next() {
		var ctx models.Context
		if err := rows.Scan(&ctx.ID, &ctx.UserID, &ctx.Name, &ctx.Color, &ctx.CreatedAt); err != nil {
			return nil, err
		}
		contexts = append(contexts, ctx)
	}

	return contexts, rows.Err()
}

func (r *Repository) CreateContext(ctx *models.Context) error {
	_, err := r.db.Exec(`
		INSERT INTO contexts (id, user_id, name, color, drive_folder_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`,
		ctx.ID, ctx.UserID, ctx.Name, ctx.Color, ctx.ID, ctx.CreatedAt, time.Now(),
	)
	return err
}

func (r *Repository) UpdateContext(contextID string, name string, color string) error {
	_, err := r.db.Exec(`
		UPDATE contexts SET
			name = ?,
			color = ?,
			updated_at = ?
		WHERE id = ?
	`, name, color, time.Now(), contextID)
	return err
}

func (r *Repository) UpdateNotesContextName(oldName string, newName string, userID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			context = ?,
			updated_at = ?
		WHERE context = ? AND user_id = ?
	`, newName, time.Now(), oldName, userID)
	return err
}

func (r *Repository) DeleteContext(contextID string) error {
	_, err := r.db.Exec("DELETE FROM contexts WHERE id = ?", contextID)
	return err
}

func (r *Repository) GetContextByName(userID, name string) (*models.Context, error) {
	var ctx models.Context
	err := r.db.QueryRow(`
		SELECT id, user_id, name, color, created_at
		FROM contexts
		WHERE user_id = ? AND name = ?
	`, userID, name).Scan(&ctx.ID, &ctx.UserID, &ctx.Name, &ctx.Color, &ctx.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &ctx, nil
}

func (r *Repository) GetContextByID(contextID string) (*models.Context, error) {
	var ctx models.Context
	err := r.db.QueryRow(`
		SELECT id, user_id, name, color, created_at
		FROM contexts
		WHERE id = ?
	`, contextID).Scan(&ctx.ID, &ctx.UserID, &ctx.Name, &ctx.Color, &ctx.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &ctx, nil
}

// ==================== NOTES ====================

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
		// Don't load content for list view (performance)
		note.Content = ""
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

// NoteWithMeta is an internal struct that includes sync metadata
type NoteWithMeta struct {
	models.Note
	DriveFileID string
	Deleted     bool
}

func (r *Repository) GetPendingSyncNotes(limit int) ([]NoteWithMeta, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content, drive_file_id, deleted, created_at, updated_at
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
		var deleted int
		if err := rows.Scan(
			&note.ID, &note.UserID, &note.Context, &note.Date,
			&note.Content, &driveFileID, &deleted, &note.CreatedAt, &note.UpdatedAt,
		); err != nil {
			return nil, err
		}
		note.DriveFileID = driveFileID.String
		note.Deleted = deleted == 1
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

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

func (r *Repository) DeleteNote(userID, context, date string) error {
	// Mark as deleted and pending sync instead of actually deleting
	// This allows sync worker to delete from Drive first
	_, err := r.db.Exec(`
		UPDATE notes
		SET deleted = 1, sync_pending = 1, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = ? AND context = ? AND date = ?
	`, userID, context, date)
	return err
}

// HardDeleteNote actually removes the note from the database
// Only called after successful Drive deletion
func (r *Repository) HardDeleteNote(userID, context, date string) error {
	_, err := r.db.Exec(`
		DELETE FROM notes
		WHERE user_id = ? AND context = ? AND date = ?
	`, userID, context, date)
	return err
}

// MarkNoteAsNotPending marks a note as not pending sync to avoid infinite retry loops
func (r *Repository) MarkNoteAsNotPending(noteID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			sync_pending = 0,
			sync_status = ?
		WHERE id = ?
	`, string(models.SyncStatusAbandoned), noteID)
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

// GetFailedSyncNotes returns notes that have failed sync (for admin/debugging)
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
