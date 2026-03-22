package database

import (
	"daily-notes/models"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserCRUD(t *testing.T) {
	repo, cleanup := setupTestRepo(t)
	defer cleanup()

	t.Run("GetUser returns existing user", func(t *testing.T) {
		// test-user created by setupTestRepo
		user, err := repo.GetUser("test-user")
		require.NoError(t, err)
		require.NotNil(t, user)
		assert.Equal(t, "test@example.com", user.Email)
		assert.Equal(t, "Test User", user.Name)
	})

	t.Run("GetUser returns nil for missing user", func(t *testing.T) {
		user, err := repo.GetUser("nonexistent")
		require.NoError(t, err)
		assert.Nil(t, user)
	})

	t.Run("UpsertUser updates existing user", func(t *testing.T) {
		user := &models.User{
			ID:          "test-user",
			GoogleID:    "google-123",
			Email:       "updated@example.com",
			Name:        "Updated Name",
			Picture:     "pic.jpg",
			CreatedAt:   time.Now(),
			LastLoginAt: time.Now(),
		}
		err := repo.UpsertUser(user)
		require.NoError(t, err)

		got, err := repo.GetUser("test-user")
		require.NoError(t, err)
		assert.Equal(t, "updated@example.com", got.Email)
		assert.Equal(t, "Updated Name", got.Name)
	})

	t.Run("UpdateUserSettings", func(t *testing.T) {
		settings := models.UserSettings{
			Theme:             "light",
			WeekStart:         1,
			Timezone:          "America/New_York",
			DateFormat:        "MM-DD-YY",
			UniqueContextMode: true,
		}
		err := repo.UpdateUserSettings("test-user", settings)
		require.NoError(t, err)

		got, err := repo.GetUser("test-user")
		require.NoError(t, err)
		assert.Equal(t, "light", got.Settings.Theme)
		assert.Equal(t, 1, got.Settings.WeekStart)
		assert.Equal(t, "America/New_York", got.Settings.Timezone)
		assert.Equal(t, "MM-DD-YY", got.Settings.DateFormat)
		assert.True(t, got.Settings.UniqueContextMode)
	})

	t.Run("UpdateUserSettings for nonexistent user is no-op", func(t *testing.T) {
		settings := models.UserSettings{Theme: "dark"}
		err := repo.UpdateUserSettings("nonexistent", settings)
		require.NoError(t, err) // No error, just 0 rows affected
	})
}
