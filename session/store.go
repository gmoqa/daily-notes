package session

import (
	"daily-notes/models"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Store handles session persistence
type Store struct {
	db *sql.DB
}

// NewStore creates a new session store with the given database connection
func NewStore(database *sql.DB) *Store {
	if database == nil {
		panic("session.NewStore called with nil database")
	}
	fmt.Println("[Session Store] Initialized with database connection")
	return &Store{db: database}
}

// Create creates a new session in the database
func (s *Store) Create(userID, email, name, picture, accessToken, refreshToken string, tokenExpiry time.Time, settings models.UserSettings) (*models.Session, error) {
	if s.db == nil {
		return nil, sql.ErrConnDone
	}

	sessionID := uuid.New().String()
	now := time.Now()
	expiresAt := now.Add(30 * 24 * time.Hour)

	_, err := s.db.Exec(`
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
		fmt.Printf("[Session Store] ERROR creating session: %v\n", err)
		fmt.Printf("[Session Store] SessionID: %s, UserID: %s, Email: %s\n", sessionID, userID, email)
		return nil, err
	}

	fmt.Printf("[Session Store] Session created successfully for user: %s\n", email)

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

// Get retrieves a session by its ID
func (s *Store) Get(sessionID string) (*models.Session, error) {
	var session models.Session
	var settings models.UserSettings

	err := s.db.QueryRow(`
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

// GetByUserID retrieves the most recent session for a user
func (s *Store) GetByUserID(userID string) *models.Session {
	var session models.Session
	var settings models.UserSettings

	err := s.db.QueryRow(`
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

// Update updates an existing session
func (s *Store) Update(sessionID string, session *models.Session) error {
	now := time.Now()

	_, err := s.db.Exec(`
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

// UpdateUserToken updates just the OAuth tokens for a specific user
func (s *Store) UpdateUserToken(userID string, accessToken, refreshToken string, tokenExpiry time.Time) error {
	_, err := s.db.Exec(`
		UPDATE sessions SET
			access_token = ?,
			refresh_token = ?,
			token_expiry = ?,
			last_used_at = ?
		WHERE user_id = ?
	`,
		accessToken, refreshToken, tokenExpiry, time.Now(), userID,
	)

	return err
}

// Delete removes a session from the database
func (s *Store) Delete(sessionID string) error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE id = ?", sessionID)
	return err
}

// CleanupExpired removes all expired sessions from the database
func (s *Store) CleanupExpired() {
	_, err := s.db.Exec("DELETE FROM sessions WHERE expires_at < ?", time.Now())
	if err != nil {
		// Log error but don't crash
		return
	}
}

// StartCleanupRoutine starts a background goroutine to cleanup expired sessions
func (s *Store) StartCleanupRoutine() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			s.CleanupExpired()
		}
	}()
}
