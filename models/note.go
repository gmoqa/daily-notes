package models

import "time"

// SyncStatus represents the synchronization state of a note
type SyncStatus string

const (
	SyncStatusPending    SyncStatus = "pending"     // Waiting to be synced
	SyncStatusSyncing    SyncStatus = "syncing"     // Currently being synced
	SyncStatusSynced     SyncStatus = "synced"      // Successfully synced
	SyncStatusFailed     SyncStatus = "failed"      // Sync failed (will retry)
	SyncStatusAbandoned  SyncStatus = "abandoned"   // Too many failures, stopped retrying
)

const (
	// MaxSyncRetries is the maximum number of times we'll retry a failed sync
	MaxSyncRetries = 5
)

type UserSettings struct {
	Theme                string `json:"theme"`
	WeekStart            int    `json:"weekStart"`
	Timezone             string `json:"timezone"`
	DateFormat           string `json:"dateFormat"`
	UniqueContextMode    bool   `json:"uniqueContextMode"`
	ShowBreadcrumb       bool   `json:"showBreadcrumb"`
	ShowMarkdownEditor   bool   `json:"showMarkdownEditor"`
	HideNewContextButton bool   `json:"hideNewContextButton"`
}

type User struct {
	ID          string       `json:"id"`
	GoogleID    string       `json:"google_id"`
	Email       string       `json:"email"`
	Name        string       `json:"name"`
	Picture     string       `json:"picture"`
	Settings    UserSettings `json:"settings"`
	CreatedAt   time.Time    `json:"created_at"`
	LastLoginAt time.Time    `json:"last_login_at"`
}

type UpdateSettingsRequest struct {
	Theme                string `json:"theme" validate:"required,theme"`
	WeekStart            int    `json:"weekStart" validate:"gte=0,lte=6"`
	Timezone             string `json:"timezone" validate:"required,timezone"`
	DateFormat           string `json:"dateFormat" validate:"required,oneof=DD-MM-YY MM-DD-YY YYYY-MM-DD"`
	UniqueContextMode    bool   `json:"uniqueContextMode"`
	ShowBreadcrumb       bool   `json:"showBreadcrumb"`
	ShowMarkdownEditor   bool   `json:"showMarkdownEditor"`
	HideNewContextButton bool   `json:"hideNewContextButton"`
}

type Note struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	Context            string     `json:"context"`
	Date               string     `json:"date"`
	Content            string     `json:"content"`
	SyncStatus         SyncStatus `json:"sync_status,omitempty"`
	SyncRetryCount     int        `json:"sync_retry_count,omitempty"`
	SyncLastAttemptAt  *time.Time `json:"sync_last_attempt_at,omitempty"`
	SyncError          string     `json:"sync_error,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type Context struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateNoteRequest struct {
	Context string `json:"context" validate:"required,min=1,max=100,contextname"`
	Date    string `json:"date" validate:"required,dateformat"`
	Content string `json:"content"` // Content can be empty
}

type CreateContextRequest struct {
	Name  string `json:"name" validate:"required,min=2,max=100,contextname"`
	Color string `json:"color" validate:"required,bulmacolor"`
}

type UpdateContextRequest struct {
	Name  string `json:"name" validate:"required,min=2,max=100,contextname"`
	Color string `json:"color" validate:"required,bulmacolor"`
}

type Session struct {
	ID           string       `json:"id"`
	UserID       string       `json:"user_id"`
	Email        string       `json:"email"`
	Name         string       `json:"name"`
	Picture      string       `json:"picture"`
	AccessToken  string       `json:"-"`
	RefreshToken string       `json:"-"`
	TokenExpiry  time.Time    `json:"-"`
	Settings     UserSettings `json:"settings"`
	ExpiresAt    time.Time    `json:"expires_at"`
	CreatedAt    time.Time    `json:"created_at"`
	LastUsedAt   time.Time    `json:"last_used_at"`
}

type LoginRequest struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
	// For authorization code flow (modern, recommended)
	Code string `json:"code,omitempty"`
	// For One Tap sign-in (ID token from Google)
	IDToken string `json:"id_token,omitempty"`
}
