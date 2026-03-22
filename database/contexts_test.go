package database

import (
	"daily-notes/models"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContextCRUD(t *testing.T) {
	repo, cleanup := setupTestRepo(t)
	defer cleanup()

	ctx := &models.Context{
		ID:        "ctx-1",
		UserID:    "test-user",
		Name:      "Work",
		Color:     "primary",
		CreatedAt: time.Now(),
	}

	t.Run("CreateContext", func(t *testing.T) {
		err := repo.CreateContext(ctx)
		require.NoError(t, err)
	})

	t.Run("GetContextByID", func(t *testing.T) {
		got, err := repo.GetContextByID("ctx-1")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "Work", got.Name)
		assert.Equal(t, "primary", got.Color)
		assert.Equal(t, "test-user", got.UserID)
	})

	t.Run("GetContextByID not found", func(t *testing.T) {
		got, err := repo.GetContextByID("nonexistent")
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("GetContextByName", func(t *testing.T) {
		got, err := repo.GetContextByName("test-user", "Work")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "ctx-1", got.ID)
	})

	t.Run("GetContextByName not found", func(t *testing.T) {
		got, err := repo.GetContextByName("test-user", "Nonexistent")
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("GetContextByName wrong user", func(t *testing.T) {
		got, err := repo.GetContextByName("other-user", "Work")
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("GetContexts", func(t *testing.T) {
		// Add a second context
		ctx2 := &models.Context{
			ID:        "ctx-2",
			UserID:    "test-user",
			Name:      "Personal",
			Color:     "info",
			CreatedAt: time.Now(),
		}
		err := repo.CreateContext(ctx2)
		require.NoError(t, err)

		contexts, err := repo.GetContexts("test-user")
		require.NoError(t, err)
		assert.Len(t, contexts, 2)
	})

	t.Run("GetContexts empty for other user", func(t *testing.T) {
		contexts, err := repo.GetContexts("other-user")
		require.NoError(t, err)
		assert.Empty(t, contexts)
	})

	t.Run("UpdateContext", func(t *testing.T) {
		err := repo.UpdateContext("ctx-1", "Projects", "danger", "test-user")
		require.NoError(t, err)

		got, err := repo.GetContextByID("ctx-1")
		require.NoError(t, err)
		assert.Equal(t, "Projects", got.Name)
		assert.Equal(t, "danger", got.Color)
	})

	t.Run("UpdateContext wrong user returns error", func(t *testing.T) {
		err := repo.UpdateContext("ctx-1", "Hacked", "danger", "attacker-user")
		assert.Error(t, err)

		// Verify context was NOT updated
		got, err := repo.GetContextByID("ctx-1")
		require.NoError(t, err)
		assert.Equal(t, "Projects", got.Name) // unchanged
	})

	t.Run("UpdateNotesContextName", func(t *testing.T) {
		// Create a note under the old context name
		note := &models.Note{
			UserID:    "test-user",
			Context:   "Projects",
			Date:      "2025-01-01",
			Content:   "test",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := repo.UpsertNote(note, false)
		require.NoError(t, err)

		err = repo.UpdateNotesContextName("Projects", "Engineering", "test-user")
		require.NoError(t, err)

		// Note should have new context name
		got, err := repo.GetNote("test-user", "Engineering", "2025-01-01")
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, "Engineering", got.Context)

		// Old name should return nil
		old, err := repo.GetNote("test-user", "Projects", "2025-01-01")
		require.NoError(t, err)
		assert.Nil(t, old)
	})

	t.Run("DeleteContext", func(t *testing.T) {
		err := repo.DeleteContext("ctx-2", "test-user")
		require.NoError(t, err)

		got, err := repo.GetContextByID("ctx-2")
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("DeleteContext wrong user returns error", func(t *testing.T) {
		err := repo.DeleteContext("ctx-1", "attacker-user")
		assert.Error(t, err)

		// Context should still exist
		got, err := repo.GetContextByID("ctx-1")
		require.NoError(t, err)
		assert.NotNil(t, got)
	})
}
