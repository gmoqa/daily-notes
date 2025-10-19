package app

import (
	"daily-notes/database"
	"daily-notes/services"
	"daily-notes/session"
	"daily-notes/sync"
	"daily-notes/validator"
	"log/slog"
)

// App holds all application dependencies
// This struct is the central point for dependency injection
type App struct {
	// Infrastructure
	Repo         *database.Repository
	SyncWorker   *sync.Worker
	SessionStore *session.Store
	Validator    *validator.Validator
	Logger       *slog.Logger

	// Services (Business Logic Layer)
	NoteService    *services.NoteService
	ContextService *services.ContextService
	AuthService    *services.AuthService
}

// New creates a new App instance with all dependencies
func New(repo *database.Repository, syncWorker *sync.Worker, sessionStore *session.Store, storageFactory services.StorageFactory, logger *slog.Logger) *App {
	// Create services with proper dependency injection
	noteService := services.NewNoteService(repo, syncWorker)
	contextService := services.NewContextService(repo, storageFactory)
	authService := services.NewAuthService(repo, sessionStore, syncWorker, storageFactory)

	return &App{
		// Infrastructure
		Repo:         repo,
		SyncWorker:   syncWorker,
		SessionStore: sessionStore,
		Validator:    validator.New(),
		Logger:       logger,

		// Services
		NoteService:    noteService,
		ContextService: contextService,
		AuthService:    authService,
	}
}
