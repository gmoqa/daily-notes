package models

import "time"

type UserSettings struct {
	Theme             string `json:"theme"`
	WeekStart         int    `json:"weekStart"`
	Timezone          string `json:"timezone"`
	DateFormat        string `json:"dateFormat"`
	UniqueContextMode bool   `json:"uniqueContextMode"`
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
	Theme             string `json:"theme"`
	WeekStart         int    `json:"weekStart"`
	Timezone          string `json:"timezone"`
	DateFormat        string `json:"dateFormat"`
	UniqueContextMode bool   `json:"uniqueContextMode"`
}

type Note struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Context   string    `json:"context"`
	Date      string    `json:"date"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Context struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateNoteRequest struct {
	Context string `json:"context"`
	Date    string `json:"date"`
	Content string `json:"content"`
}

type CreateContextRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
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
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
}
