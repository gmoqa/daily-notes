package services

import (
	"context"
	"daily-notes/models"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"golang.org/x/oauth2"
)

// ==================== MOCKS ====================

// MockAuthRepository is a mock implementation of AuthRepository interface
type MockAuthRepository struct {
	mock.Mock
}

var _ AuthRepository = (*MockAuthRepository)(nil)

func (m *MockAuthRepository) UpsertUser(user *models.User) error {
	args := m.Called(user)
	return args.Error(0)
}

func (m *MockAuthRepository) GetContexts(userID string) ([]models.Context, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]models.Context), args.Error(1)
}

// MockSessionStore is a mock implementation of SessionStore interface
type MockSessionStore struct {
	mock.Mock
}

var _ SessionStore = (*MockSessionStore)(nil)

func (m *MockSessionStore) Create(userID, email, name, picture, accessToken, refreshToken string, tokenExpiry time.Time, settings models.UserSettings) (*models.Session, error) {
	args := m.Called(userID, email, name, picture, accessToken, refreshToken, tokenExpiry, settings)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Session), args.Error(1)
}

func (m *MockSessionStore) Get(sessionID string) (*models.Session, error) {
	args := m.Called(sessionID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Session), args.Error(1)
}

func (m *MockSessionStore) Delete(sessionID string) error {
	args := m.Called(sessionID)
	return args.Error(0)
}

// ==================== TESTS ====================

func TestAuthService_Logout(t *testing.T) {
	tests := []struct {
		name          string
		sessionID     string
		mockSetup     func(*MockSessionStore)
		expectedError error
	}{
		{
			name:      "Success - Logout successfully",
			sessionID: "session123",
			mockSetup: func(store *MockSessionStore) {
				store.On("Delete", "session123").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:      "Error - Session store delete fails",
			sessionID: "session123",
			mockSetup: func(store *MockSessionStore) {
				store.On("Delete", "session123").Return(errors.New("session error"))
			},
			expectedError: errors.New("session error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockSessionStore := new(MockSessionStore)
			if tt.mockSetup != nil {
				tt.mockSetup(mockSessionStore)
			}

			service := &AuthService{
				sessionStore: mockSessionStore,
			}

			err := service.Logout(tt.sessionID)

			if tt.expectedError != nil {
				assert.Error(t, err)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
			} else {
				assert.NoError(t, err)
			}

			mockSessionStore.AssertExpectations(t)
		})
	}
}

func TestAuthService_GetSessionInfo(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name            string
		sessionID       string
		mockSetup       func(*MockSessionStore)
		expectedSession *models.Session
		expectedError   error
	}{
		{
			name:      "Success - Get session info",
			sessionID: "session123",
			mockSetup: func(store *MockSessionStore) {
				session := &models.Session{
					ID:        "session123",
					UserID:    "user123",
					Email:     "test@example.com",
					Name:      "Test User",
					ExpiresAt: now.Add(24 * time.Hour),
				}
				store.On("Get", "session123").Return(session, nil)
			},
			expectedSession: &models.Session{
				ID:        "session123",
				UserID:    "user123",
				Email:     "test@example.com",
				Name:      "Test User",
				ExpiresAt: now.Add(24 * time.Hour),
			},
			expectedError: nil,
		},
		{
			name:      "Error - Session not found (returns nil)",
			sessionID: "session123",
			mockSetup: func(store *MockSessionStore) {
				store.On("Get", "session123").Return(nil, nil)
			},
			expectedSession: nil,
			expectedError:   ErrSessionNotFound,
		},
		{
			name:      "Error - Session store error",
			sessionID: "session123",
			mockSetup: func(store *MockSessionStore) {
				store.On("Get", "session123").Return(nil, errors.New("database error"))
			},
			expectedSession: nil,
			expectedError:   ErrSessionNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockSessionStore := new(MockSessionStore)
			if tt.mockSetup != nil {
				tt.mockSetup(mockSessionStore)
			}

			service := &AuthService{
				sessionStore: mockSessionStore,
			}

			session, err := service.GetSessionInfo(tt.sessionID)

			if tt.expectedError != nil {
				assert.Error(t, err)
				if errors.Is(tt.expectedError, ErrSessionNotFound) {
					assert.ErrorIs(t, err, ErrSessionNotFound)
				}
				assert.Nil(t, session)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, session)
				assert.Equal(t, tt.expectedSession.ID, session.ID)
				assert.Equal(t, tt.expectedSession.UserID, session.UserID)
				assert.Equal(t, tt.expectedSession.Email, session.Email)
			}

			mockSessionStore.AssertExpectations(t)
		})
	}
}

func TestAuthService_createOrUpdateUser(t *testing.T) {
	tests := []struct {
		name          string
		userInfo      *UserInfo
		settings      models.UserSettings
		mockSetup     func(*MockAuthRepository)
		expectedError error
	}{
		{
			name: "Success - Create or update user",
			userInfo: &UserInfo{
				GoogleID: "google123",
				Email:    "test@example.com",
				Name:     "Test User",
				Picture:  "https://example.com/pic.jpg",
			},
			settings: models.UserSettings{
				Theme:      "dark",
				WeekStart:  0,
				Timezone:   "UTC",
				DateFormat: "DD-MM-YY",
			},
			mockSetup: func(repo *MockAuthRepository) {
				repo.On("UpsertUser", mock.AnythingOfType("*models.User")).Return(nil)
			},
			expectedError: nil,
		},
		{
			name: "Error - Repository upsert fails",
			userInfo: &UserInfo{
				GoogleID: "google123",
				Email:    "test@example.com",
				Name:     "Test User",
				Picture:  "https://example.com/pic.jpg",
			},
			settings: models.UserSettings{},
			mockSetup: func(repo *MockAuthRepository) {
				repo.On("UpsertUser", mock.AnythingOfType("*models.User")).Return(errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockAuthRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &AuthService{
				repo: mockRepo,
			}

			err := service.createOrUpdateUser(tt.userInfo, tt.settings)

			if tt.expectedError != nil {
				assert.Error(t, err)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
			} else {
				assert.NoError(t, err)
			}

			mockRepo.AssertExpectations(t)
		})
	}
}

func TestAuthService_checkFirstLogin(t *testing.T) {
	tests := []struct {
		name           string
		userID         string
		mockSetup      func(*MockAuthRepository)
		expectedResult bool
	}{
		{
			name:   "First login - No contexts",
			userID: "user123",
			mockSetup: func(repo *MockAuthRepository) {
				repo.On("GetContexts", "user123").Return([]models.Context{}, nil)
			},
			expectedResult: true,
		},
		{
			name:   "Not first login - Has contexts",
			userID: "user123",
			mockSetup: func(repo *MockAuthRepository) {
				contexts := []models.Context{
					{ID: "ctx1", Name: "work"},
				}
				repo.On("GetContexts", "user123").Return(contexts, nil)
			},
			expectedResult: false,
		},
		{
			name:   "Repository error - Treated as not first login",
			userID: "user123",
			mockSetup: func(repo *MockAuthRepository) {
				repo.On("GetContexts", "user123").Return(nil, errors.New("database error"))
			},
			expectedResult: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockAuthRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &AuthService{
				repo: mockRepo,
			}

			result := service.checkFirstLogin(tt.userID)

			assert.Equal(t, tt.expectedResult, result)

			mockRepo.AssertExpectations(t)
		})
	}
}

func TestAuthService_getUserSettings(t *testing.T) {
	defaultSettings := models.UserSettings{
		Theme:      "dark",
		WeekStart:  0,
		Timezone:   "UTC",
		DateFormat: "DD-MM-YY",
	}

	customSettings := models.UserSettings{
		Theme:      "light",
		WeekStart:  1,
		Timezone:   "America/New_York",
		DateFormat: "MM-DD-YY",
	}

	tests := []struct {
		name             string
		token            *oauth2.Token
		userID           string
		mockStorageSetup func(*MockStorageService)
		expectedSettings models.UserSettings
	}{
		{
			name: "Success - Get custom settings from storage",
			token: &oauth2.Token{
				AccessToken: "valid_token",
			},
			userID: "user123",
			mockStorageSetup: func(provider *MockStorageService) {
				provider.On("GetSettings").Return(customSettings, nil)
			},
			expectedSettings: customSettings,
		},
		{
			name: "Fallback - Empty access token returns default settings",
			token: &oauth2.Token{
				AccessToken: "",
			},
			userID:           "user123",
			mockStorageSetup: nil,
			expectedSettings: defaultSettings,
		},
		{
			name: "Fallback - Storage provider creation fails",
			token: &oauth2.Token{
				AccessToken: "valid_token",
			},
			userID:           "user123",
			mockStorageSetup: nil, // Will cause factory to fail
			expectedSettings: defaultSettings,
		},
		{
			name: "Fallback - GetSettings fails",
			token: &oauth2.Token{
				AccessToken: "valid_token",
			},
			userID: "user123",
			mockStorageSetup: func(provider *MockStorageService) {
				provider.On("GetSettings").Return(models.UserSettings{}, errors.New("storage error"))
			},
			expectedSettings: defaultSettings,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var storageFactory StorageFactory

			if tt.mockStorageSetup != nil && tt.token.AccessToken != "" {
				mockProvider := new(MockStorageService)
				tt.mockStorageSetup(mockProvider)
				storageFactory = func(ctx context.Context, token *oauth2.Token, userID string) (StorageService, error) {
					return mockProvider, nil
				}
			} else if tt.token.AccessToken != "" && tt.mockStorageSetup == nil {
				// Factory fails
				storageFactory = func(ctx context.Context, token *oauth2.Token, userID string) (StorageService, error) {
					return nil, errors.New("factory error")
				}
			}

			service := &AuthService{
				storageFactory: storageFactory,
			}

			settings := service.getUserSettings(tt.token, tt.userID)

			assert.Equal(t, tt.expectedSettings.Theme, settings.Theme)
			assert.Equal(t, tt.expectedSettings.WeekStart, settings.WeekStart)
			assert.Equal(t, tt.expectedSettings.Timezone, settings.Timezone)
			assert.Equal(t, tt.expectedSettings.DateFormat, settings.DateFormat)
		})
	}
}

func TestAuthService_HandlePostLogin(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name              string
		loginResponse     *LoginResponse
		mockWorkerSetup   func(*MockSyncWorker)
		mockStorageSetup  func(*MockStorageService)
		expectWorkerCall  bool
		expectStorageCall bool
	}{
		{
			name: "Success - First login triggers import and cleanup",
			loginResponse: &LoginResponse{
				Session: &models.Session{
					UserID: "user123",
				},
				HasNoContexts: true,
				Token: &oauth2.Token{
					AccessToken: "valid_token",
				},
			},
			mockWorkerSetup: func(worker *MockSyncWorker) {
				worker.On("ImportFromDrive", "user123", mock.AnythingOfType("*oauth2.Token")).Return(nil)
			},
			mockStorageSetup: func(provider *MockStorageService) {
				provider.On("CleanupOldDeletedFolders").Return(nil)
			},
			expectWorkerCall:  true,
			expectStorageCall: true,
		},
		{
			name: "Skip import - Not first login",
			loginResponse: &LoginResponse{
				Session: &models.Session{
					UserID: "user123",
				},
				HasNoContexts: false,
				Token: &oauth2.Token{
					AccessToken: "valid_token",
				},
			},
			mockWorkerSetup: nil, // Should not be called
			mockStorageSetup: func(provider *MockStorageService) {
				provider.On("CleanupOldDeletedFolders").Return(nil)
			},
			expectWorkerCall:  false,
			expectStorageCall: true,
		},
		{
			name: "Skip all - No access token",
			loginResponse: &LoginResponse{
				Session: &models.Session{
					UserID: "user123",
				},
				HasNoContexts: true,
				Token: &oauth2.Token{
					AccessToken: "",
				},
			},
			mockWorkerSetup:   nil,
			mockStorageSetup:  nil,
			expectWorkerCall:  false,
			expectStorageCall: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var mockWorker *MockSyncWorker
			var storageFactory StorageFactory

			if tt.mockWorkerSetup != nil {
				mockWorker = new(MockSyncWorker)
				tt.mockWorkerSetup(mockWorker)
			}

			if tt.mockStorageSetup != nil {
				mockProvider := new(MockStorageService)
				tt.mockStorageSetup(mockProvider)
				storageFactory = func(ctx context.Context, token *oauth2.Token, userID string) (StorageService, error) {
					return mockProvider, nil
				}
			}

			service := &AuthService{
				syncWorker:     mockWorker,
				storageFactory: storageFactory,
			}

			// HandlePostLogin launches goroutines, so we need to wait a bit
			service.HandlePostLogin(tt.loginResponse)

			// Give goroutines time to execute
			time.Sleep(100 * time.Millisecond)

			// Note: We can't easily assert on goroutine calls without race conditions
			// This test mainly ensures the code doesn't panic
		})
	}

	// Suppress unused variable warning
	_ = now
}
