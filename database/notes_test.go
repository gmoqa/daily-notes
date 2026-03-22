package database

import (
	"daily-notes/models"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNoteCRUD(t *testing.T) {
	repo, cleanup := setupTestRepo(t)
	defer cleanup()

	note := &models.Note{
		UserID:    "test-user",
		Context:   "Work",
		Date:      "2025-03-20",
		Content:   "Hello world",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	t.Run("UpsertNote creates new note", func(t *testing.T) {
		err := repo.UpsertNote(note, true)
		require.NoError(t, err)
		assert.Equal(t, "test-user-Work-2025-03-20", note.ID)
	})

	t.Run("GetNote retrieves note", func(t *testing.T) {
		got, err := repo.GetNote("test-user", "Work", "2025-03-20")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "Hello world", got.Content)
		assert.Equal(t, models.SyncStatusPending, got.SyncStatus)
	})

	t.Run("GetNote returns nil for missing note", func(t *testing.T) {
		got, err := repo.GetNote("test-user", "Work", "1999-01-01")
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("UpsertNote updates existing note", func(t *testing.T) {
		note.Content = "Updated content"
		note.UpdatedAt = time.Now()
		err := repo.UpsertNote(note, true)
		require.NoError(t, err)

		got, err := repo.GetNote("test-user", "Work", "2025-03-20")
		require.NoError(t, err)
		assert.Equal(t, "Updated content", got.Content)
	})

	t.Run("UpsertNote without sync pending", func(t *testing.T) {
		n := &models.Note{
			UserID:    "test-user",
			Context:   "Work",
			Date:      "2025-03-21",
			Content:   "No sync",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := repo.UpsertNote(n, false)
		require.NoError(t, err)

		got, err := repo.GetNote("test-user", "Work", "2025-03-21")
		require.NoError(t, err)
		assert.Equal(t, models.SyncStatusSynced, got.SyncStatus)
	})

	t.Run("GetNotesByContext returns paginated results", func(t *testing.T) {
		// Create several notes
		for i := 1; i <= 5; i++ {
			n := &models.Note{
				UserID:    "test-user",
				Context:   "Pagination",
				Date:      time.Date(2025, 1, i, 0, 0, 0, 0, time.UTC).Format("2006-01-02"),
				Content:   "note",
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			require.NoError(t, repo.UpsertNote(n, false))
		}

		// Limit 3
		notes, err := repo.GetNotesByContext("test-user", "Pagination", 3, 0)
		require.NoError(t, err)
		assert.Len(t, notes, 3)

		// Content is cleared for list view
		assert.Empty(t, notes[0].Content)

		// Offset 3
		notes2, err := repo.GetNotesByContext("test-user", "Pagination", 10, 3)
		require.NoError(t, err)
		assert.Len(t, notes2, 2)
	})

	t.Run("GetNotesByContext empty for wrong user", func(t *testing.T) {
		notes, err := repo.GetNotesByContext("other-user", "Work", 50, 0)
		require.NoError(t, err)
		assert.Empty(t, notes)
	})

	t.Run("GetAllNotesByUser", func(t *testing.T) {
		notes, err := repo.GetAllNotesByUser("test-user")
		require.NoError(t, err)
		assert.True(t, len(notes) > 0)
		// Content should be present (not list view)
		hasContent := false
		for _, n := range notes {
			if n.Content != "" {
				hasContent = true
				break
			}
		}
		assert.True(t, hasContent)
	})

	t.Run("DeleteNote soft deletes", func(t *testing.T) {
		err := repo.DeleteNote("test-user", "Work", "2025-03-20")
		require.NoError(t, err)

		// Should not be retrievable (deleted = 1)
		got, err := repo.GetNote("test-user", "Work", "2025-03-20")
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("UpsertNote does not resurrect deleted note", func(t *testing.T) {
		n := &models.Note{
			UserID:    "test-user",
			Context:   "Work",
			Date:      "2025-03-20",
			Content:   "Should not update",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := repo.UpsertNote(n, true)
		require.NoError(t, err)

		// Still deleted
		got, err := repo.GetNote("test-user", "Work", "2025-03-20")
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("HardDeleteNote removes permanently", func(t *testing.T) {
		// Create and soft delete
		n := &models.Note{
			UserID:    "test-user",
			Context:   "Temp",
			Date:      "2025-06-01",
			Content:   "delete me",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		require.NoError(t, repo.UpsertNote(n, false))
		require.NoError(t, repo.DeleteNote("test-user", "Temp", "2025-06-01"))

		err := repo.HardDeleteNote("test-user", "Temp", "2025-06-01")
		require.NoError(t, err)

		// Verify completely gone (not even soft deleted)
		var count int
		repo.db.QueryRow("SELECT COUNT(*) FROM notes WHERE user_id = ? AND context = ? AND date = ?",
			"test-user", "Temp", "2025-06-01").Scan(&count)
		assert.Equal(t, 0, count)
	})
}
