package session

import (
	"daily-notes/models"
	"sync"
	"time"

	"github.com/google/uuid"
)

var (
	store = &SessionStore{
		sessions: make(map[string]*models.Session),
	}
)

type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*models.Session
}

func Create(userID, email, name, picture, accessToken, refreshToken string, tokenExpiry time.Time, settings models.UserSettings) (*models.Session, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	sessionID := uuid.New().String()
	session := &models.Session{
		ID:           sessionID,
		UserID:       userID,
		Email:        email,
		Name:         name,
		Picture:      picture,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenExpiry:  tokenExpiry,
		Settings:     settings,
		ExpiresAt:    time.Now().Add(30 * 24 * time.Hour),
		CreatedAt:    time.Now(),
		LastUsedAt:   time.Now(),
	}

	store.sessions[sessionID] = session
	return session, nil
}

func Get(sessionID string) (*models.Session, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	session, exists := store.sessions[sessionID]
	if !exists {
		return nil, nil
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, nil
	}

	return session, nil
}

func Update(sessionID string, session *models.Session) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	session.LastUsedAt = time.Now()
	store.sessions[sessionID] = session
	return nil
}

func Delete(sessionID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	delete(store.sessions, sessionID)
	return nil
}

func CleanupExpired() {
	store.mu.Lock()
	defer store.mu.Unlock()

	for id, session := range store.sessions {
		if time.Now().After(session.ExpiresAt) {
			delete(store.sessions, id)
		}
	}
}

func StartCleanupRoutine() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			CleanupExpired()
		}
	}()
}
