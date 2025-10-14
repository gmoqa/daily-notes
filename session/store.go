package session

import (
	"daily-notes/models"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

var (
	db *sql.DB
)

type SessionStore struct {
	db *sql.DB
}

// Initialize sets the database connection for the session store
func Initialize(database *sql.DB) {
	if database == nil {
		panic("session.Initialize called with nil database")
	}
	db = database
	fmt.Println("[Session Store] Initialized with database connection")
}

func Create(userID, email, name, picture, accessToken, refreshToken string, tokenExpiry time.Time, settings models.UserSettings) (*models.Session, error) {
	if db == nil {
		return nil, sql.ErrConnDone
	}

	sessionID := uuid.New().String()
	now := time.Now()
	expiresAt := now.Add(30 * 24 * time.Hour)

	_, err := db.Exec(`
		INSERT INTO sessions (
			id, user_id, email, name, picture,
			access_token, refresh_token, token_expiry,
			settings_theme, settings_week_start, settings_timezone,
			settings_date_format, settings_unique_context_mode,
			settings_show_breadcrumb, settings_show_markdown_editor,
			settings_hide_new_context_button,
			expires_at, created_at, last_used_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		sessionID, userID, email, name, picture,
		accessToken, refreshToken, tokenExpiry,
		settings.Theme, settings.WeekStart, settings.Timezone,
		settings.DateFormat, settings.UniqueContextMode,
		settings.ShowBreadcrumb, settings.ShowMarkdownEditor,
		settings.HideNewContextButton,
		expiresAt, now, now,
	)
	if err != nil {
		return nil, err
	}

	return &models.Session{
		ID:           sessionID,
		UserID:       userID,
		Email:        email,
		Name:         name,
		Picture:      picture,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenExpiry:  tokenExpiry,
		Settings:     settings,
		ExpiresAt:    expiresAt,
		CreatedAt:    now,
		LastUsedAt:   now,
	}, nil
}

func Get(sessionID string) (*models.Session, error) {
	var session models.Session
	var settings models.UserSettings

	err := db.QueryRow(`
		SELECT id, user_id, email, name, picture,
			access_token, refresh_token, token_expiry,
			settings_theme, settings_week_start, settings_timezone,
			settings_date_format, settings_unique_context_mode,
			settings_show_breadcrumb, settings_show_markdown_editor,
			settings_hide_new_context_button,
			expires_at, created_at, last_used_at
		FROM sessions
		WHERE id = ? AND expires_at > ?
	`, sessionID, time.Now()).Scan(
		&session.ID, &session.UserID, &session.Email, &session.Name, &session.Picture,
		&session.AccessToken, &session.RefreshToken, &session.TokenExpiry,
		&settings.Theme, &settings.WeekStart, &settings.Timezone,
		&settings.DateFormat, &settings.UniqueContextMode,
		&settings.ShowBreadcrumb, &settings.ShowMarkdownEditor,
		&settings.HideNewContextButton,
		&session.ExpiresAt, &session.CreatedAt, &session.LastUsedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	session.Settings = settings
	return &session, nil
}

func GetByUserID(userID string) *models.Session {
	var session models.Session
	var settings models.UserSettings

	err := db.QueryRow(`
		SELECT id, user_id, email, name, picture,
			access_token, refresh_token, token_expiry,
			settings_theme, settings_week_start, settings_timezone,
			settings_date_format, settings_unique_context_mode,
			settings_show_breadcrumb, settings_show_markdown_editor,
			settings_hide_new_context_button,
			expires_at, created_at, last_used_at
		FROM sessions
		WHERE user_id = ? AND expires_at > ?
		ORDER BY last_used_at DESC
		LIMIT 1
	`, userID, time.Now()).Scan(
		&session.ID, &session.UserID, &session.Email, &session.Name, &session.Picture,
		&session.AccessToken, &session.RefreshToken, &session.TokenExpiry,
		&settings.Theme, &settings.WeekStart, &settings.Timezone,
		&settings.DateFormat, &settings.UniqueContextMode,
		&settings.ShowBreadcrumb, &settings.ShowMarkdownEditor,
		&settings.HideNewContextButton,
		&session.ExpiresAt, &session.CreatedAt, &session.LastUsedAt,
	)

	if err != nil {
		return nil
	}

	session.Settings = settings
	return &session
}

func Update(sessionID string, session *models.Session) error {
	now := time.Now()

	_, err := db.Exec(`
		UPDATE sessions SET
			email = ?,
			name = ?,
			picture = ?,
			access_token = ?,
			refresh_token = ?,
			token_expiry = ?,
			settings_theme = ?,
			settings_week_start = ?,
			settings_timezone = ?,
			settings_date_format = ?,
			settings_unique_context_mode = ?,
			settings_show_breadcrumb = ?,
			settings_show_markdown_editor = ?,
			settings_hide_new_context_button = ?,
			last_used_at = ?
		WHERE id = ?
	`,
		session.Email, session.Name, session.Picture,
		session.AccessToken, session.RefreshToken, session.TokenExpiry,
		session.Settings.Theme, session.Settings.WeekStart, session.Settings.Timezone,
		session.Settings.DateFormat, session.Settings.UniqueContextMode,
		session.Settings.ShowBreadcrumb, session.Settings.ShowMarkdownEditor,
		session.Settings.HideNewContextButton,
		now, sessionID,
	)

	return err
}

func Delete(sessionID string) error {
	_, err := db.Exec("DELETE FROM sessions WHERE id = ?", sessionID)
	return err
}

func CleanupExpired() {
	_, err := db.Exec("DELETE FROM sessions WHERE expires_at < ?", time.Now())
	if err != nil {
		// Log error but don't crash
		return
	}
}

func StartCleanupRoutine() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			CleanupExpired()
		}
	}()
}
