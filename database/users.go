package database

import (
	"daily-notes/models"
	"database/sql"
	"time"
)

// ==================== USER OPERATIONS ====================

// GetUser retrieves a user by ID with their settings
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

// UpsertUser creates or updates a user record
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

// UpdateUserSettings updates only the user's settings
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
