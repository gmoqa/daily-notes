package setup

import (
	"context"
	"daily-notes/app"
	"daily-notes/database"
	"daily-notes/services"
	"daily-notes/session"
	"daily-notes/storage/drive"
	"daily-notes/sync"
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/oauth2"
)

// InitDatabase initializes the SQLite database and runs migrations
func InitDatabase(dbPath string, logger *slog.Logger) (*database.DB, error) {
	db, err := database.New(dbPath)
	if err != nil {
		return nil, err
	}

	if err := db.Migrate(); err != nil {
		db.Close()
		return nil, err
	}

	logger.Info("database initialized", "path", dbPath)
	return db, nil
}

// InitApp initializes the application with all dependencies
func InitApp(db *database.DB, logger *slog.Logger) *app.App {
	// Create repository
	repo := database.NewRepository(db)

	// Initialize session store with database
	sessionStore := session.NewStore(db.DB)
	logger.Info("session store initialized with database")

	// Start session cleanup
	sessionStore.StartCleanupRoutine()
	logger.Info("session cleanup routine started")

	// Create getUserToken function that uses sessionStore
	getUserToken := func(userID string) (*oauth2.Token, error) {
		sess := sessionStore.GetByUserID(userID)
		if sess == nil {
			return nil, fiber.ErrUnauthorized
		}
		return &oauth2.Token{
			AccessToken:  sess.AccessToken,
			RefreshToken: sess.RefreshToken,
			Expiry:       sess.TokenExpiry,
		}, nil
	}

	// Create storage factory using Drive
	storageFactory := func(ctx context.Context, token *oauth2.Token, userID string) (services.StorageService, error) {
		return drive.NewService(ctx, token, userID)
	}
	logger.Info("storage factory configured with Drive")

	// Create sync worker storage factory
	syncStorageFactory := func(ctx context.Context, token *oauth2.Token, userID string) (sync.StorageService, error) {
		return drive.NewService(ctx, token, userID)
	}

	// Start sync worker for background sync
	syncWorker := sync.NewWorker(repo, sessionStore, syncStorageFactory, getUserToken)
	syncWorker.Start()
	logger.Info("sync worker started")

	// Create App with all dependencies injected
	application := app.New(repo, syncWorker, sessionStore, storageFactory, logger)
	logger.Info("application initialized with dependency injection")

	return application
}

// Shutdown performs graceful shutdown of all services
func Shutdown(syncWorker *sync.Worker, db *database.DB, logger *slog.Logger) {
	logger.Info("shutting down services...")

	// Stop sync worker
	if syncWorker != nil {
		syncWorker.Stop()
		logger.Info("sync worker stopped")
	}

	// Close database
	if db != nil {
		db.Close()
		logger.Info("database closed")
	}
}
