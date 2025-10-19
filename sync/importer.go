package sync

import (
	"context"
	"log"

	"golang.org/x/oauth2"
)

// ==================== CLOUD STORAGE IMPORT ====================

// ImportFromDrive imports all notes and contexts from cloud storage for a user
// This is typically called on first login or when user requests a full sync
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
	w.updateTokenIfRefreshed(provider, token, userID, "Sync Worker")

	log.Printf("[Sync Worker] Imported %d contexts and %d notes from storage", len(config.Contexts), totalNotes)
	return nil
}
