package database

import (
	"daily-notes/models"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestRepo(t *testing.T) (*Repository, func()) {
	t.Helper()

	tmpDir, err := os.MkdirTemp("", "sync-test-*")
	require.NoError(t, err)

	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := New(dbPath)
	require.NoError(t, err)

	err = db.Migrate()
	require.NoError(t, err)

	repo := NewRepository(db)

	// Create test user
	testUser := &models.User{
		ID:        "test-user",
		GoogleID:  "google-123",
		Email:     "test@example.com",
		Name:      "Test User",
		CreatedAt: time.Now(),
	}
	err = repo.UpsertUser(testUser)
	require.NoError(t, err)

	cleanup := func() {
		db.Close()
		os.RemoveAll(tmpDir)
	}

	return repo, cleanup
}

func TestSyncStateManagement(t *testing.T) {
	repo, cleanup := setupTestRepo(t)
	defer cleanup()

	t.Run("New note starts with pending status", func(t *testing.T) {
		note := &models.Note{
			UserID:    "test-user",
			Context:   "Work",
			Date:      "2025-10-17",
			Content:   "Test content",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := repo.UpsertNote(note, true)
		require.NoError(t, err)

		retrieved, err := repo.GetNote("test-user", "Work", "2025-10-17")
		require.NoError(t, err)
		require.NotNil(t, retrieved)

		assert.Equal(t, models.SyncStatusPending, retrieved.SyncStatus)
		assert.Equal(t, 0, retrieved.SyncRetryCount)
		assert.Nil(t, retrieved.SyncLastAttemptAt)
		assert.Empty(t, retrieved.SyncError)
	})

	t.Run("Mark note as syncing", func(t *testing.T) {
		note := &models.Note{
			UserID:    "test-user",
			Context:   "Personal",
			Date:      "2025-10-17",
			Content:   "Another note",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := repo.UpsertNote(note, true)
		require.NoError(t, err)

		noteID := note.ID
		err = repo.MarkNoteSyncing(noteID)
		require.NoError(t, err)

		retrieved, err := repo.GetNote("test-user", "Personal", "2025-10-17")
		require.NoError(t, err)

		assert.Equal(t, models.SyncStatusSyncing, retrieved.SyncStatus)
		assert.NotNil(t, retrieved.SyncLastAttemptAt)
	})

	t.Run("Mark note as synced", func(t *testing.T) {
		note := &models.Note{
			UserID:    "test-user",
			Context:   "Projects",
			Date:      "2025-10-17",
			Content:   "Project note",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := repo.UpsertNote(note, true)
		require.NoError(t, err)

		noteID := note.ID
		driveFileID := "drive-file-123"

		err = repo.MarkNoteSynced(noteID, driveFileID)
		require.NoError(t, err)

		retrieved, err := repo.GetNote("test-user", "Projects", "2025-10-17")
		require.NoError(t, err)

		assert.Equal(t, models.SyncStatusSynced, retrieved.SyncStatus)
		assert.Equal(t, 0, retrieved.SyncRetryCount)
		assert.Empty(t, retrieved.SyncError)
		assert.NotNil(t, retrieved.SyncLastAttemptAt)
	})

	t.Run("Mark note as failed increments retry count", func(t *testing.T) {
		note := &models.Note{
			UserID:    "test-user",
			Context:   "Failed",
			Date:      "2025-10-17",
			Content:   "This will fail",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := repo.UpsertNote(note, true)
		require.NoError(t, err)

		noteID := note.ID

		// First failure
		err = repo.MarkNoteSyncFailed(noteID, "Network error")
		require.NoError(t, err)

		retrieved, err := repo.GetNote("test-user", "Failed", "2025-10-17")
		require.NoError(t, err)

		assert.Equal(t, models.SyncStatusFailed, retrieved.SyncStatus)
		assert.Equal(t, 1, retrieved.SyncRetryCount)
		assert.Equal(t, "Network error", retrieved.SyncError)
		assert.NotNil(t, retrieved.SyncLastAttemptAt)

		// Second failure
		err = repo.MarkNoteSyncFailed(noteID, "Timeout")
		require.NoError(t, err)

		retrieved, err = repo.GetNote("test-user", "Failed", "2025-10-17")
		require.NoError(t, err)

		assert.Equal(t, models.SyncStatusFailed, retrieved.SyncStatus)
		assert.Equal(t, 2, retrieved.SyncRetryCount)
		assert.Equal(t, "Timeout", retrieved.SyncError)
	})

	t.Run("Note abandoned after max retries", func(t *testing.T) {
		note := &models.Note{
			UserID:    "test-user",
			Context:   "Abandoned",
			Date:      "2025-10-17",
			Content:   "This will be abandoned",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := repo.UpsertNote(note, true)
		require.NoError(t, err)

		noteID := note.ID

		// Fail MaxSyncRetries times
		for i := 0; i < models.MaxSyncRetries; i++ {
			err = repo.MarkNoteSyncFailed(noteID, "Persistent error")
			require.NoError(t, err)
		}

		retrieved, err := repo.GetNote("test-user", "Abandoned", "2025-10-17")
		require.NoError(t, err)

		assert.Equal(t, models.SyncStatusAbandoned, retrieved.SyncStatus)
		assert.Equal(t, models.MaxSyncRetries, retrieved.SyncRetryCount)
	})

	t.Run("Retry failed note resets status", func(t *testing.T) {
		note := &models.Note{
			UserID:    "test-user",
			Context:   "Retry",
			Date:      "2025-10-17",
			Content:   "Retry this note",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := repo.UpsertNote(note, true)
		require.NoError(t, err)

		noteID := note.ID

		// Mark as failed
		err = repo.MarkNoteSyncFailed(noteID, "Initial failure")
		require.NoError(t, err)

		// Retry
		err = repo.RetrySyncNote(noteID)
		require.NoError(t, err)

		retrieved, err := repo.GetNote("test-user", "Retry", "2025-10-17")
		require.NoError(t, err)

		assert.Equal(t, models.SyncStatusPending, retrieved.SyncStatus)
		assert.Equal(t, 0, retrieved.SyncRetryCount)
		assert.Empty(t, retrieved.SyncError)
	})

	t.Run("Get failed sync notes", func(t *testing.T) {
		// Create some failed notes
		for i := 0; i < 3; i++ {
			note := &models.Note{
				UserID:    "test-user",
				Context:   "TestFailed",
				Date:      time.Now().AddDate(0, 0, -i).Format("2006-01-02"),
				Content:   "Failed note",
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}

			err := repo.UpsertNote(note, true)
			require.NoError(t, err)

			err = repo.MarkNoteSyncFailed(note.ID, "Test error")
			require.NoError(t, err)
		}

		failedNotes, err := repo.GetFailedSyncNotes("test-user", 10)
		require.NoError(t, err)

		// Should have at least 3 failed notes
		assert.GreaterOrEqual(t, len(failedNotes), 3)

		// All should be failed or abandoned
		for _, note := range failedNotes {
			assert.Contains(t, []models.SyncStatus{
				models.SyncStatusFailed,
				models.SyncStatusAbandoned,
			}, note.SyncStatus)
		}
	})
}

func TestPendingSyncNotes(t *testing.T) {
	repo, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create notes with different sync states
	notes := []struct {
		context    string
		date       string
		markForSync bool
	}{
		{"Pending1", "2025-10-17", true},
		{"Pending2", "2025-10-17", true},
		{"Synced", "2025-10-17", false},
	}

	for _, n := range notes {
		note := &models.Note{
			UserID:    "test-user",
			Context:   n.context,
			Date:      n.date,
			Content:   "Content",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := repo.UpsertNote(note, n.markForSync)
		require.NoError(t, err)
	}

	pendingNotes, err := repo.GetPendingSyncNotes(10)
	require.NoError(t, err)

	// Should have 2 pending notes
	assert.Equal(t, 2, len(pendingNotes))

	for _, note := range pendingNotes {
		assert.Contains(t, []string{"Pending1", "Pending2"}, note.Context)
	}
}
