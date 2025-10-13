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

	var contexts []models.Context
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

// ==================== NOTES ====================

func (r *Repository) GetNote(userID, context, date string) (*models.Note, error) {
	var note models.Note
	err := r.db.QueryRow(`
		SELECT id, user_id, context, date, content, drive_file_id, created_at, updated_at
		FROM notes
		WHERE user_id = ? AND context = ? AND date = ?
	`, userID, context, date).Scan(
		&note.ID, &note.UserID, &note.Context, &note.Date,
		&note.Content, &note.ID, &note.CreatedAt, &note.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &note, nil
}

func (r *Repository) UpsertNote(note *models.Note, markForSync bool) error {
	syncPending := 0
	if markForSync {
		syncPending = 1
	}

	id := fmt.Sprintf("%s-%s-%s", note.UserID, note.Context, note.Date)
	if note.ID == "" {
		note.ID = id
	}

	_, err := r.db.Exec(`
		INSERT INTO notes (id, user_id, context, date, content, drive_file_id,
			sync_pending, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, context, date) DO UPDATE SET
			content = excluded.content,
			sync_pending = excluded.sync_pending,
			updated_at = excluded.updated_at
	`,
		id, note.UserID, note.Context, note.Date, note.Content,
		note.ID, syncPending, note.CreatedAt, note.UpdatedAt,
	)
	return err
}

func (r *Repository) GetNotesByContext(userID, context string, limit, offset int) ([]models.Note, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content, created_at, updated_at
		FROM notes
		WHERE user_id = ? AND context = ?
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

func (r *Repository) GetPendingSyncNotes(limit int) ([]models.Note, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content, drive_file_id, created_at, updated_at
		FROM notes
		WHERE sync_pending = 1
		ORDER BY updated_at ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []models.Note
	for rows.Next() {
		var note models.Note
		var driveFileID sql.NullString
		if err := rows.Scan(
			&note.ID, &note.UserID, &note.Context, &note.Date,
			&note.Content, &driveFileID, &note.CreatedAt, &note.UpdatedAt,
		); err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

func (r *Repository) MarkNoteSynced(noteID, driveFileID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			drive_file_id = ?,
			sync_pending = 0,
			synced_at = ?
		WHERE id = ?
	`, driveFileID, time.Now(), noteID)
	return err
}

func (r *Repository) GetAllNotesByUser(userID string) ([]models.Note, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, context, date, content, created_at, updated_at
		FROM notes
		WHERE user_id = ?
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
