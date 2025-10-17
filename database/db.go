package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	*sql.DB
}

func New(dbPath string) (*DB, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	// Open database
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	// Enable WAL mode for better concurrency
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	// Enable foreign keys
	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	return &DB{db}, nil
}

func (db *DB) Migrate() error {
	queries := []string{
		// Users table
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			google_id TEXT UNIQUE NOT NULL,
			email TEXT NOT NULL,
			name TEXT,
			picture TEXT,
			settings_theme TEXT DEFAULT 'dark',
			settings_week_start INTEGER DEFAULT 0,
			settings_timezone TEXT DEFAULT 'UTC',
			settings_date_format TEXT DEFAULT 'DD-MM-YY',
			settings_unique_context_mode INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// Contexts table
		`CREATE TABLE IF NOT EXISTS contexts (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			color TEXT NOT NULL,
			drive_folder_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, name)
		)`,

		// Notes table
		`CREATE TABLE IF NOT EXISTS notes (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			context TEXT NOT NULL,
			date TEXT NOT NULL,
			content TEXT,
			drive_file_id TEXT,
			synced_at DATETIME,
			sync_pending INTEGER DEFAULT 1,
			deleted INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, context, date)
		)`,

		// Sessions table
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			email TEXT NOT NULL,
			name TEXT NOT NULL,
			picture TEXT,
			access_token TEXT NOT NULL,
			refresh_token TEXT,
			token_expiry DATETIME,
			settings_theme TEXT DEFAULT 'dark',
			settings_week_start INTEGER DEFAULT 0,
			settings_timezone TEXT DEFAULT 'UTC',
			settings_date_format TEXT DEFAULT 'DD-MM-YY',
			settings_unique_context_mode INTEGER DEFAULT 0,
			settings_show_breadcrumb INTEGER DEFAULT 1,
			settings_show_markdown_editor INTEGER DEFAULT 0,
			settings_hide_new_context_button INTEGER DEFAULT 0,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,

		// Add deleted column to notes table if it doesn't exist (migration)
		`ALTER TABLE notes ADD COLUMN deleted INTEGER DEFAULT 0`,

		// Indexes for performance
		`CREATE INDEX IF NOT EXISTS idx_notes_user_context ON notes(user_id, context)`,
		`CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id, date)`,
		`CREATE INDEX IF NOT EXISTS idx_notes_sync_pending ON notes(sync_pending) WHERE sync_pending = 1`,
		`CREATE INDEX IF NOT EXISTS idx_contexts_user ON contexts(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
	}

	for i, query := range queries {
		if _, err := db.Exec(query); err != nil {
			// Ignore "duplicate column" error for ALTER TABLE (migration already applied)
			if i == 4 && strings.Contains(err.Error(), "duplicate column name") {
				// Migration already applied
				continue
			}
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	return nil
}

func (db *DB) Close() error {
	return db.DB.Close()
}
