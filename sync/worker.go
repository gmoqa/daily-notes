package sync

import (
	"context"
	"daily-notes/database"
	"daily-notes/drive"
	"daily-notes/session"
	"log"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

type Worker struct {
	repo         *database.Repository
	interval     time.Duration
	running      bool
	mu           sync.Mutex
	stopChan     chan struct{}
	getUserToken func(userID string) (*oauth2.Token, error)
}

func NewWorker(repo *database.Repository, getUserToken func(userID string) (*oauth2.Token, error)) *Worker {
	return &Worker{
		repo:         repo,
		interval:     5 * time.Second, // Reduced from 30s to 5s for faster sync
		getUserToken: getUserToken,
		stopChan:     make(chan struct{}),
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
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	// Run immediately on start
	w.syncPendingNotes()

	for {
		select {
		case <-ticker.C:
			w.syncPendingNotes()
		case <-w.stopChan:
			return
		}
	}
}

func (w *Worker) syncPendingNotes() {
	// Get batch of pending notes
	notes, err := w.repo.GetPendingSyncNotes(50)
	if err != nil {
		log.Printf("[Sync Worker] Failed to get pending notes: %v", err)
		return
	}

	if len(notes) == 0 {
		return
	}

	log.Printf("[Sync Worker] Syncing %d pending notes", len(notes))

	// Group notes by user
	notesByUser := make(map[string][]database.NoteWithMeta)
	for _, note := range notes {
		notesByUser[note.UserID] = append(notesByUser[note.UserID], note)
	}

	// Sync each user's notes
	for userID, userNotes := range notesByUser {
		w.syncUserNotes(userID, userNotes)
	}
}

func (w *Worker) syncUserNotes(userID string, notes []database.NoteWithMeta) {
	// Get user's Drive token
	token, err := w.getUserToken(userID)
	if err != nil {
		log.Printf("[Sync Worker] Failed to get token for user %s: %v", userID, err)
		// Mark all notes as not pending since we can't sync without a token
		w.markNotesAsNotPending(notes)
		return
	}

	// Create Drive service
	driveService, err := drive.NewService(context.Background(), token, userID)
	if err != nil {
		log.Printf("[Sync Worker] Failed to create Drive service for user %s: %v", userID, err)
		// Mark all notes as not pending since we can't sync without Drive service
		w.markNotesAsNotPending(notes)
		return
	}

	// Separate delete operations and regular operations
	var deleteOps []database.NoteWithMeta
	var regularOps []database.NoteWithMeta
	for _, note := range notes {
		log.Printf("[Sync Worker] Processing note: context=%s, date=%s, deleted=%v", note.Context, note.Date, note.Deleted)
		if note.Deleted {
			deleteOps = append(deleteOps, note)
		} else {
			regularOps = append(regularOps, note)
		}
	}

	log.Printf("[Sync Worker] Separated operations: %d deletes, %d regular", len(deleteOps), len(regularOps))

	// Process deletions first (higher priority)
	syncedCount := 0
	tokenExpired := false
	
	for _, note := range deleteOps {
		if err := w.syncNote(driveService, &note); err != nil {
			// Check if it's a token expiration error
			if w.isTokenExpiredError(err) {
				log.Printf("[Sync Worker] Token expired for user %s, stopping sync", userID)
				tokenExpired = true
				break
			}
			log.Printf("[Sync Worker] Failed to delete note %s: %v", note.ID, err)
			continue
		}
		log.Printf("[Sync Worker] Successfully deleted note from Drive: %s/%s", note.Context, note.Date)
		syncedCount++
	}

	// Then process regular operations (only if token is still valid)
	if !tokenExpired {
		for _, note := range regularOps {
			if err := w.syncNote(driveService, &note); err != nil {
				// Check if it's a token expiration error
				if w.isTokenExpiredError(err) {
					log.Printf("[Sync Worker] Token expired for user %s, stopping sync", userID)
					tokenExpired = true
					break
				}
				log.Printf("[Sync Worker] Failed to sync note %s: %v", note.ID, err)
				continue
			}
			syncedCount++
		}
	}

	// If token expired, mark all remaining notes as not pending
	if tokenExpired {
		log.Printf("[Sync Worker] Marking %d notes as not pending due to expired token", len(notes))
		w.markNotesAsNotPending(notes)
		return
	}

	if syncedCount > 0 {
		log.Printf("[Sync Worker] Successfully synced %d/%d notes for user %s", syncedCount, len(notes), userID)
	}

	// Update the token in the session if it was refreshed
	currentToken, err := driveService.GetCurrentToken()
	if err == nil && currentToken != nil {
		// Only update if the token actually changed
		if currentToken.AccessToken != token.AccessToken || !currentToken.Expiry.Equal(token.Expiry) {
			log.Printf("[Sync Worker] Token was refreshed for user %s, updating session", userID)
			if err := session.UpdateUserToken(userID, currentToken.AccessToken, currentToken.RefreshToken, currentToken.Expiry); err != nil {
				log.Printf("[Sync Worker] Failed to update token in session: %v", err)
			}
		}
	}
}

func (w *Worker) syncNote(driveService *drive.Service, note *database.NoteWithMeta) error {
	if note.Deleted {
		// Delete from Drive
		if err := driveService.DeleteNote(note.Context, note.Date); err != nil {
			return err
		}
		// Hard delete from database after successful Drive deletion
		return w.repo.HardDeleteNote(note.UserID, note.Context, note.Date)
	}

	// Upload to Drive
	syncedNote, err := driveService.UpsertNote(note.Context, note.Date, note.Content)
	if err != nil {
		return err
	}

	// Mark as synced in database
	return w.repo.MarkNoteSynced(note.ID, syncedNote.ID)
}

// ImportFromDrive imports all notes and contexts from Google Drive for a user
func (w *Worker) ImportFromDrive(userID string, token *oauth2.Token) error {
	log.Printf("[Sync Worker] Starting Drive import for user %s", userID)

	// Create Drive service
	driveService, err := drive.NewService(context.Background(), token, userID)
	if err != nil {
		return err
	}

	// Get config from Drive (contains contexts)
	config, err := driveService.GetConfig()
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
		notes, err := driveService.GetAllNotesInContext(ctx.Name)
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
	currentToken, err := driveService.GetCurrentToken()
	if err == nil && currentToken != nil {
		// Only update if the token actually changed
		if currentToken.AccessToken != token.AccessToken || !currentToken.Expiry.Equal(token.Expiry) {
			log.Printf("[Sync Worker] Token was refreshed during import for user %s, updating session", userID)
			if err := session.UpdateUserToken(userID, currentToken.AccessToken, currentToken.RefreshToken, currentToken.Expiry); err != nil {
				log.Printf("[Sync Worker] Failed to update token in session: %v", err)
			}
		}
	}

	log.Printf("[Sync Worker] Imported %d contexts and %d notes from Drive", len(config.Contexts), totalNotes)
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

// markNotesAsNotPending marks a batch of notes as not pending to avoid infinite retry loops
func (w *Worker) markNotesAsNotPending(notes []database.NoteWithMeta) {
	for _, note := range notes {
		if err := w.repo.MarkNoteAsNotPending(note.ID); err != nil {
			log.Printf("[Sync Worker] Failed to mark note %s as not pending: %v", note.ID, err)
		}
	}
}
