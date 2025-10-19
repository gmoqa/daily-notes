package sync

import (
	"context"
	"daily-notes/database"
	"daily-notes/models"
	"daily-notes/session"
	"daily-notes/storage/drive"
	"log"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

// StorageService interface defines storage operations needed by sync worker
type StorageService interface {
	UpsertNote(contextName, date, content string) (*models.Note, error)
	DeleteNote(contextName, date string) error
	GetAllNotesInContext(contextName string) ([]models.Note, error)
	GetConfig() (*drive.Config, error)
	GetCurrentToken() (*oauth2.Token, error)
}

// StorageFactory creates storage service instances
type StorageFactory func(ctx context.Context, token *oauth2.Token, userID string) (StorageService, error)

// Worker coordinates background synchronization between local database and cloud storage
// See domain-specific files:
// - executor.go: Core sync execution logic
// - retry.go: Retry and backoff strategies
// - importer.go: Cloud storage import operations
// - token_manager.go: OAuth token refresh handling
type Worker struct {
	repo            *database.Repository
	sessionStore    *session.Store
	storageFactory  StorageFactory
	baseInterval    time.Duration
	maxInterval     time.Duration
	currentInterval time.Duration
	running         bool
	mu              sync.Mutex
	stopChan        chan struct{}
	getUserToken    func(userID string) (*oauth2.Token, error)
}

// NewWorker creates a new sync worker instance
func NewWorker(repo *database.Repository, sessionStore *session.Store, storageFactory StorageFactory, getUserToken func(userID string) (*oauth2.Token, error)) *Worker {
	return &Worker{
		repo:            repo,
		sessionStore:    sessionStore,
		storageFactory:  storageFactory,
		baseInterval:    2 * time.Minute, // Base interval for retries
		maxInterval:     5 * time.Minute, // Max interval when no work
		currentInterval: 2 * time.Minute, // Start with base interval
		getUserToken:    getUserToken,
		stopChan:        make(chan struct{}),
	}
}

// Start begins the background sync worker
func (w *Worker) Start() {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return
	}
	w.running = true
	w.mu.Unlock()

	log.Println("[Sync Worker] Starting background sync worker")

	go w.run()
}

// Stop gracefully stops the background sync worker
func (w *Worker) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.running {
		return
	}

	log.Println("[Sync Worker] Stopping background sync worker")
	close(w.stopChan)
	w.running = false
}

// run is the main worker loop with adaptive backoff
func (w *Worker) run() {
	ticker := time.NewTicker(w.currentInterval)
	defer ticker.Stop()

	// Run immediately on start
	w.syncPendingNotes()

	for {
		select {
		case <-ticker.C:
			hadWork := w.syncPendingNotes()

			// Adaptive backoff: increase interval when no work, reset when there's work
			w.mu.Lock()
			if hadWork {
				// Reset to base interval when there's work
				if w.currentInterval != w.baseInterval {
					w.currentInterval = w.baseInterval
					ticker.Reset(w.currentInterval)
					log.Printf("[Sync Worker] Work found, reset interval to %v", w.currentInterval)
				}
			} else {
				// Increase interval up to max when no work
				if w.currentInterval < w.maxInterval {
					w.currentInterval = w.maxInterval
					ticker.Reset(w.currentInterval)
					log.Printf("[Sync Worker] No work, increased interval to %v", w.currentInterval)
				}
			}
			w.mu.Unlock()
		case <-w.stopChan:
			return
		}
	}
}
