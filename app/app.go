package app

import (
	"daily-notes/database"
	"daily-notes/session"
	"daily-notes/sync"
	"log/slog"
)

// App holds all application dependencies
// This struct is the central point for dependency injection
type App struct {
	Repo         *database.Repository
	SyncWorker   *sync.Worker
	SessionStore *session.Store
	Logger       *slog.Logger
}

// New creates a new App instance with all dependencies
func New(repo *database.Repository, syncWorker *sync.Worker, sessionStore *session.Store, logger *slog.Logger) *App {
	return &App{
		Repo:         repo,
		SyncWorker:   syncWorker,
		SessionStore: sessionStore,
		Logger:       logger,
	}
}
