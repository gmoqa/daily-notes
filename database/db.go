package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

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
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, context, date)
		)`,

		// Indexes for performance
		`CREATE INDEX IF NOT EXISTS idx_notes_user_context ON notes(user_id, context)`,
		`CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id, date)`,
		`CREATE INDEX IF NOT EXISTS idx_notes_sync_pending ON notes(sync_pending) WHERE sync_pending = 1`,
		`CREATE INDEX IF NOT EXISTS idx_contexts_user ON contexts(user_id)`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	return nil
}

func (db *DB) Close() error {
	return db.DB.Close()
}
