package sync

import (
	"context"
	"daily-notes/database"
	"daily-notes/session"
	"daily-notes/storage"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

type Worker struct {
	repo            *database.Repository
	sessionStore    *session.Store
	storageFactory  storage.Factory
	baseInterval    time.Duration
	maxInterval     time.Duration
	currentInterval time.Duration
	running         bool
	mu              sync.Mutex
	stopChan        chan struct{}
	getUserToken    func(userID string) (*oauth2.Token, error)
}

func NewWorker(repo *database.Repository, sessionStore *session.Store, storageFactory storage.Factory, getUserToken func(userID string) (*oauth2.Token, error)) *Worker {
	return &Worker{
		repo:            repo,
		sessionStore:    sessionStore,
		storageFactory:  storageFactory,
		baseInterval:    2 * time.Minute,  // Base interval for retries
		maxInterval:     5 * time.Minute,  // Max interval when no work
		currentInterval: 2 * time.Minute,  // Start with base interval
		getUserToken:    getUserToken,
		stopChan:        make(chan struct{}),
	}
}

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

func (w *Worker) syncPendingNotes() bool {
	// Get batch of pending notes (only retry old ones to avoid race with immediate sync)
	notes, err := w.repo.GetPendingSyncNotes(50)
	if err != nil {
		log.Printf("[Sync Worker] Failed to get pending notes: %v", err)
		return false
	}

	if len(notes) == 0 {
		return false
	}

	// Filter notes older than 30 seconds (avoid race with immediate sync)
	var oldNotes []database.NoteWithMeta
	now := time.Now()
	for _, note := range notes {
		if note.SyncLastAttemptAt != nil {
			if now.Sub(*note.SyncLastAttemptAt) >= 30*time.Second {
				oldNotes = append(oldNotes, note)
			}
		} else {
			// No previous attempt, check creation time
			if now.Sub(note.UpdatedAt) >= 30*time.Second {
				oldNotes = append(oldNotes, note)
			}
		}
	}

	if len(oldNotes) == 0 {
		return false
	}

	log.Printf("[Sync Worker] Processing %d pending/failed notes for retry", len(oldNotes))

	// Group notes by user
	notesByUser := make(map[string][]database.NoteWithMeta)
	for _, note := range oldNotes {
		notesByUser[note.UserID] = append(notesByUser[note.UserID], note)
	}

	// Sync each user's notes
	for userID, userNotes := range notesByUser {
		w.syncUserNotes(userID, userNotes)
	}

	return true // Had work
}

// syncResult holds the result of a sync operation
type syncResult struct {
	syncedCount  int
	failedCount  int
	tokenExpired bool
}

// syncNotesWithDrive is the unified sync logic for both immediate and batch sync
// It handles token retrieval, storage provider creation, note syncing, and token refresh
func (w *Worker) syncNotesWithDrive(userID string, notes []database.NoteWithMeta, logPrefix string) *syncResult {
	result := &syncResult{}

	// Get user's token
	token, err := w.getUserToken(userID)
	if err != nil {
		log.Printf("[%s] Failed to get token for user %s: %v", logPrefix, userID, err)
		w.markNotesAsFailed(notes, fmt.Sprintf("Failed to get authentication token: %v", err))
		result.failedCount = len(notes)
		return result
	}

	// Create storage provider
	provider, err := w.storageFactory(context.Background(), token, userID)
	if err != nil {
		log.Printf("[%s] Failed to create storage provider for user %s: %v", logPrefix, userID, err)
		w.markNotesAsFailed(notes, fmt.Sprintf("Failed to connect to cloud storage: %v", err))
		result.failedCount = len(notes)
		return result
	}

	// Separate delete operations and regular operations
	var deleteOps []database.NoteWithMeta
	var regularOps []database.NoteWithMeta
	for _, note := range notes {
		if note.Deleted {
			deleteOps = append(deleteOps, note)
		} else {
			regularOps = append(regularOps, note)
		}
	}

	// Process deletions first (higher priority)
	for _, note := range deleteOps {
		// Mark note as currently syncing
		if err := w.repo.MarkNoteSyncing(note.ID); err != nil {
			log.Printf("[%s] Failed to mark note as syncing: %v", logPrefix, err)
		}

		if err := w.syncNote(provider, &note); err != nil {
			// Check if it's a token expiration error
			if w.isTokenExpiredError(err) {
				log.Printf("[%s] Token expired for user %s, stopping sync", logPrefix, userID)
				result.tokenExpired = true
				w.repo.MarkNoteSyncFailed(note.ID, "Authentication token expired")
				result.failedCount++
				break
			}
			// Mark as failed with error message
			w.repo.MarkNoteSyncFailed(note.ID, fmt.Sprintf("Delete failed: %v", err))
			result.failedCount++
			continue
		}
		result.syncedCount++
	}

	// Then process regular operations (only if token is still valid)
	if !result.tokenExpired {
		for _, note := range regularOps {
			// Mark note as currently syncing
			if err := w.repo.MarkNoteSyncing(note.ID); err != nil {
				log.Printf("[%s] Failed to mark note as syncing: %v", logPrefix, err)
			}

			if err := w.syncNote(provider, &note); err != nil {
				// Check if it's a token expiration error
				if w.isTokenExpiredError(err) {
					log.Printf("[%s] Token expired for user %s, stopping sync", logPrefix, userID)
					result.tokenExpired = true
					w.repo.MarkNoteSyncFailed(note.ID, "Authentication token expired")
					result.failedCount++
					break
				}
				// Mark as failed with error message
				w.repo.MarkNoteSyncFailed(note.ID, fmt.Sprintf("Sync failed: %v", err))
				result.failedCount++
				continue
			}
			result.syncedCount++
		}
	}

	// If token expired, mark all remaining unprocessed notes as failed
	if result.tokenExpired {
		log.Printf("[%s] Marking remaining notes as failed due to expired token", logPrefix)
		errorMsg := "Authentication token expired, please sign in again"
		for _, note := range notes {
			w.repo.MarkNoteSyncFailed(note.ID, errorMsg)
		}
		return result
	}

	// Update the token in the session if it was refreshed
	currentToken, err := provider.GetCurrentToken()
	if err == nil && currentToken != nil {
		// Only update if the token actually changed
		if currentToken.AccessToken != token.AccessToken || !currentToken.Expiry.Equal(token.Expiry) {
			log.Printf("[%s] Token was refreshed for user %s, updating session", logPrefix, userID)
			if w.sessionStore != nil {
				if err := w.sessionStore.UpdateUserToken(userID, currentToken.AccessToken, currentToken.RefreshToken, currentToken.Expiry); err != nil {
					log.Printf("[%s] Failed to update token in session: %v", logPrefix, err)
				}
			}
		}
	}

	return result
}

func (w *Worker) syncUserNotes(userID string, notes []database.NoteWithMeta) {
	result := w.syncNotesWithDrive(userID, notes, "Sync Worker")

	if result.syncedCount > 0 || result.failedCount > 0 {
		log.Printf("[Sync Worker] Sync complete for user %s: %d succeeded, %d failed out of %d total",
			userID, result.syncedCount, result.failedCount, len(notes))
	}
}

func (w *Worker) syncNote(provider storage.Provider, note *database.NoteWithMeta) error {
	if note.Deleted {
		// Delete from storage
		if err := provider.DeleteNote(note.Context, note.Date); err != nil {
			return err
		}
		// Hard delete from database after successful deletion
		return w.repo.HardDeleteNote(note.UserID, note.Context, note.Date)
	}

	// Upload to storage
	syncedNote, err := provider.UpsertNote(note.Context, note.Date, note.Content)
	if err != nil {
		return err
	}

	// Mark as synced in database
	return w.repo.MarkNoteSynced(note.ID, syncedNote.ID)
}

// ImportFromDrive imports all notes and contexts from cloud storage for a user
func (w *Worker) ImportFromDrive(userID string, token *oauth2.Token) error {
	log.Printf("[Sync Worker] Starting storage import for user %s", userID)

	// Create storage provider
	provider, err := w.storageFactory(context.Background(), token, userID)
	if err != nil {
		return err
	}

	// Get config from storage (contains contexts)
	config, err := provider.GetConfig()
	if err != nil {
		return err
	}

	// Import contexts
	for _, ctx := range config.Contexts {
		if err := w.repo.CreateContext(&ctx); err != nil {
			log.Printf("[Sync Worker] Failed to import context %s: %v", ctx.Name, err)
		}
	}

	// Import notes for each context
	totalNotes := 0
	for _, ctx := range config.Contexts {
		notes, err := provider.GetAllNotesInContext(ctx.Name)
		if err != nil {
			log.Printf("[Sync Worker] Failed to import notes for context %s: %v", ctx.Name, err)
			continue
		}

		for _, note := range notes {
			note.UserID = userID
			// Mark as already synced (sync_pending = false)
			if err := w.repo.UpsertNote(&note, false); err != nil {
				log.Printf("[Sync Worker] Failed to import note %s: %v", note.ID, err)
			} else {
				totalNotes++
			}
		}
	}

	// Update the token in the session if it was refreshed
	currentToken, err := provider.GetCurrentToken()
	if err == nil && currentToken != nil {
		// Only update if the token actually changed
		if currentToken.AccessToken != token.AccessToken || !currentToken.Expiry.Equal(token.Expiry) {
			log.Printf("[Sync Worker] Token was refreshed during import for user %s, updating session", userID)
			if w.sessionStore != nil {
				if err := w.sessionStore.UpdateUserToken(userID, currentToken.AccessToken, currentToken.RefreshToken, currentToken.Expiry); err != nil {
					log.Printf("[Sync Worker] Failed to update token in session: %v", err)
				}
			}
		}
	}

	log.Printf("[Sync Worker] Imported %d contexts and %d notes from storage", len(config.Contexts), totalNotes)
	return nil
}

// isTokenExpiredError checks if an error is related to token expiration
func (w *Worker) isTokenExpiredError(err error) bool {
	if err == nil {
		return false
	}
	errMsg := err.Error()
	return strings.Contains(errMsg, "token expired") ||
	       strings.Contains(errMsg, "Token has been expired") ||
	       strings.Contains(errMsg, "invalid_grant") ||
	       strings.Contains(errMsg, "401")
}

// markNotesAsFailed marks a batch of notes as failed with an error message
func (w *Worker) markNotesAsFailed(notes []database.NoteWithMeta, errorMsg string) {
	for _, note := range notes {
		if err := w.repo.MarkNoteSyncFailed(note.ID, errorMsg); err != nil {
			log.Printf("[Sync Worker] Failed to mark note %s as failed: %v", note.ID, err)
		}
	}
}

// SyncNoteImmediate attempts to sync a single note immediately (non-blocking)
// This is called when a user saves a note for instant sync to Drive
func (w *Worker) SyncNoteImmediate(userID, noteContext, date string) {
	go func() {
		// Get the note from database
		note, err := w.repo.GetNote(userID, noteContext, date)
		if err != nil {
			log.Printf("[Immediate Sync] Failed to get note %s/%s: %v", noteContext, date, err)
			return
		}

		// Convert to NoteWithMeta for unified sync
		noteMeta := database.NoteWithMeta{
			Note: *note,
		}

		// Use unified sync logic
		result := w.syncNotesWithDrive(userID, []database.NoteWithMeta{noteMeta}, "Immediate Sync")

		// Log result
		if result.syncedCount > 0 {
			log.Printf("[Immediate Sync] Successfully synced note %s/%s", noteContext, date)
		} else if result.failedCount > 0 {
			log.Printf("[Immediate Sync] Failed to sync note %s/%s", noteContext, date)
		}
	}()
}
