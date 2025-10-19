package services

import (
	"daily-notes/database"
	"daily-notes/models"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"golang.org/x/oauth2"
)

// ==================== MOCKS ====================

// MockRepository is a mock implementation of NoteRepository interface
type MockRepository struct {
	mock.Mock
}

// Ensure MockRepository implements NoteRepository interface
var _ NoteRepository = (*MockRepository)(nil)

func (m *MockRepository) GetNote(userID, contextName, date string) (*models.Note, error) {
	args := m.Called(userID, contextName, date)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Note), args.Error(1)
}

func (m *MockRepository) UpsertNote(note *models.Note, syncPending bool) error {
	args := m.Called(note, syncPending)
	return args.Error(0)
}

func (m *MockRepository) DeleteNote(userID, contextName, date string) error {
	args := m.Called(userID, contextName, date)
	return args.Error(0)
}

func (m *MockRepository) GetNotesByContext(userID, contextName string, limit, offset int) ([]models.Note, error) {
	args := m.Called(userID, contextName, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]models.Note), args.Error(1)
}

func (m *MockRepository) GetFailedSyncNotes(userID string, limit int) ([]models.Note, error) {
	args := m.Called(userID, limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]models.Note), args.Error(1)
}

func (m *MockRepository) GetPendingSyncNotes(limit int) ([]database.NoteWithMeta, error) {
	args := m.Called(limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]database.NoteWithMeta), args.Error(1)
}

func (m *MockRepository) RetrySyncNote(noteID string) error {
	args := m.Called(noteID)
	return args.Error(0)
}

// MockSyncWorker is a mock implementation of SyncWorker interface
type MockSyncWorker struct {
	mock.Mock
}

// Ensure MockSyncWorker implements SyncWorker interface
var _ SyncWorker = (*MockSyncWorker)(nil)

func (m *MockSyncWorker) SyncNoteImmediate(userID, contextName, date string) {
	m.Called(userID, contextName, date)
}

func (m *MockSyncWorker) ImportFromDrive(userID string, token *oauth2.Token) error {
	args := m.Called(userID, token)
	return args.Error(0)
}

// ==================== TESTS ====================

func TestNoteService_Get(t *testing.T) {
	tests := []struct {
		name          string
		userID        string
		contextName   string
		date          string
		mockSetup     func(*MockRepository)
		expectedNote  *models.Note
		expectedError error
	}{
		{
			name:        "Success - Note exists",
			userID:      "user123",
			contextName: "work",
			date:        "2025-10-18",
			mockSetup: func(repo *MockRepository) {
				expectedNote := &models.Note{
					ID:      "user123-work-2025-10-18",
					UserID:  "user123",
					Context: "work",
					Date:    "2025-10-18",
					Content: "Test content",
				}
				repo.On("GetNote", "user123", "work", "2025-10-18").Return(expectedNote, nil)
			},
			expectedNote: &models.Note{
				ID:      "user123-work-2025-10-18",
				UserID:  "user123",
				Context: "work",
				Date:    "2025-10-18",
				Content: "Test content",
			},
			expectedError: nil,
		},
		{
			name:        "Success - Note doesn't exist, returns empty note",
			userID:      "user123",
			contextName: "personal",
			date:        "2025-10-19",
			mockSetup: func(repo *MockRepository) {
				repo.On("GetNote", "user123", "personal", "2025-10-19").Return(nil, nil)
			},
			expectedNote: &models.Note{
				UserID:  "user123",
				Context: "personal",
				Date:    "2025-10-19",
				Content: "",
			},
			expectedError: nil,
		},
		{
			name:        "Error - Repository error",
			userID:      "user123",
			contextName: "work",
			date:        "2025-10-18",
			mockSetup: func(repo *MockRepository) {
				repo.On("GetNote", "user123", "work", "2025-10-18").Return(nil, errors.New("database error"))
			},
			expectedNote:  nil,
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &NoteService{
				repo:       mockRepo,
				syncWorker: nil,
			}

			note, err := service.Get(tt.userID, tt.contextName, tt.date)

			if tt.expectedError != nil {
				assert.Error(t, err)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
				assert.Nil(t, note)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, note)
				assert.Equal(t, tt.expectedNote.UserID, note.UserID)
				assert.Equal(t, tt.expectedNote.Context, note.Context)
				assert.Equal(t, tt.expectedNote.Date, note.Date)
				assert.Equal(t, tt.expectedNote.Content, note.Content)
			}

			mockRepo.AssertExpectations(t)
		})
	}
}

func TestNoteService_Upsert(t *testing.T) {
	tests := []struct {
		name           string
		userID         string
		contextName    string
		date           string
		content        string
		mockRepoSetup  func(*MockRepository)
		mockWorkerSetup func(*MockSyncWorker)
		expectedError  error
	}{
		{
			name:        "Success - Create new note with sync",
			userID:      "user123",
			contextName: "work",
			date:        "2025-10-18",
			content:     "New note content",
			mockRepoSetup: func(repo *MockRepository) {
				repo.On("UpsertNote", mock.AnythingOfType("*models.Note"), true).Return(nil)
			},
			mockWorkerSetup: func(worker *MockSyncWorker) {
				worker.On("SyncNoteImmediate", "user123", "work", "2025-10-18").Return()
			},
			expectedError: nil,
		},
		{
			name:        "Success - Update existing note",
			userID:      "user123",
			contextName: "personal",
			date:        "2025-10-19",
			content:     "Updated content",
			mockRepoSetup: func(repo *MockRepository) {
				repo.On("UpsertNote", mock.AnythingOfType("*models.Note"), true).Return(nil)
			},
			mockWorkerSetup: func(worker *MockSyncWorker) {
				worker.On("SyncNoteImmediate", "user123", "personal", "2025-10-19").Return()
			},
			expectedError: nil,
		},
		{
			name:        "Error - Repository upsert fails",
			userID:      "user123",
			contextName: "work",
			date:        "2025-10-18",
			content:     "Content",
			mockRepoSetup: func(repo *MockRepository) {
				repo.On("UpsertNote", mock.AnythingOfType("*models.Note"), true).Return(errors.New("database error"))
			},
			mockWorkerSetup: nil,
			expectedError:   errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockRepository)
			var mockWorker *MockSyncWorker

			if tt.mockRepoSetup != nil {
				tt.mockRepoSetup(mockRepo)
			}

			if tt.mockWorkerSetup != nil {
				mockWorker = new(MockSyncWorker)
				tt.mockWorkerSetup(mockWorker)
			}

			service := &NoteService{
				repo:       mockRepo,
				syncWorker: mockWorker,
			}

			note, err := service.Upsert(tt.userID, tt.contextName, tt.date, tt.content)

			if tt.expectedError != nil {
				assert.Error(t, err)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
				assert.Nil(t, note)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, note)
				assert.Equal(t, tt.userID, note.UserID)
				assert.Equal(t, tt.contextName, note.Context)
				assert.Equal(t, tt.date, note.Date)
				assert.Equal(t, tt.content, note.Content)
			}

			mockRepo.AssertExpectations(t)
			if mockWorker != nil {
				mockWorker.AssertExpectations(t)
			}
		})
	}
}

func TestNoteService_Delete(t *testing.T) {
	tests := []struct {
		name          string
		userID        string
		contextName   string
		date          string
		mockSetup     func(*MockRepository)
		expectedError error
	}{
		{
			name:        "Success - Delete note",
			userID:      "user123",
			contextName: "work",
			date:        "2025-10-18",
			mockSetup: func(repo *MockRepository) {
				repo.On("DeleteNote", "user123", "work", "2025-10-18").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:        "Error - Repository delete fails",
			userID:      "user123",
			contextName: "work",
			date:        "2025-10-18",
			mockSetup: func(repo *MockRepository) {
				repo.On("DeleteNote", "user123", "work", "2025-10-18").Return(errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &NoteService{
				repo:       mockRepo,
				syncWorker: nil,
			}

			err := service.Delete(tt.userID, tt.contextName, tt.date)

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

func TestNoteService_ListByContext(t *testing.T) {
	tests := []struct {
		name          string
		userID        string
		contextName   string
		limit         int
		offset        int
		normalizedLimit int
		normalizedOffset int
		mockSetup     func(*MockRepository)
		expectedNotes []models.Note
		expectedError error
	}{
		{
			name:          "Success - List notes with default pagination",
			userID:        "user123",
			contextName:   "work",
			limit:         30,
			offset:        0,
			normalizedLimit: 30,
			normalizedOffset: 0,
			mockSetup: func(repo *MockRepository) {
				notes := []models.Note{
					{ID: "1", Context: "work", Date: "2025-10-18"},
					{ID: "2", Context: "work", Date: "2025-10-17"},
				}
				repo.On("GetNotesByContext", "user123", "work", 30, 0).Return(notes, nil)
			},
			expectedNotes: []models.Note{
				{ID: "1", Context: "work", Date: "2025-10-18"},
				{ID: "2", Context: "work", Date: "2025-10-17"},
			},
			expectedError: nil,
		},
		{
			name:          "Success - Normalize invalid limit (too high)",
			userID:        "user123",
			contextName:   "work",
			limit:         200, // > 100, should normalize to 30
			offset:        0,
			normalizedLimit: 30,
			normalizedOffset: 0,
			mockSetup: func(repo *MockRepository) {
				repo.On("GetNotesByContext", "user123", "work", 30, 0).Return([]models.Note{}, nil)
			},
			expectedNotes: []models.Note{},
			expectedError: nil,
		},
		{
			name:          "Success - Normalize invalid limit (zero)",
			userID:        "user123",
			contextName:   "work",
			limit:         0, // < 1, should normalize to 30
			offset:        0,
			normalizedLimit: 30,
			normalizedOffset: 0,
			mockSetup: func(repo *MockRepository) {
				repo.On("GetNotesByContext", "user123", "work", 30, 0).Return([]models.Note{}, nil)
			},
			expectedNotes: []models.Note{},
			expectedError: nil,
		},
		{
			name:          "Success - Normalize negative offset",
			userID:        "user123",
			contextName:   "work",
			limit:         30,
			offset:        -10, // Negative, should normalize to 0
			normalizedLimit: 30,
			normalizedOffset: 0,
			mockSetup: func(repo *MockRepository) {
				repo.On("GetNotesByContext", "user123", "work", 30, 0).Return([]models.Note{}, nil)
			},
			expectedNotes: []models.Note{},
			expectedError: nil,
		},
		{
			name:        "Error - Repository error",
			userID:      "user123",
			contextName: "work",
			limit:       30,
			offset:      0,
			normalizedLimit: 30,
			normalizedOffset: 0,
			mockSetup: func(repo *MockRepository) {
				repo.On("GetNotesByContext", "user123", "work", 30, 0).Return(nil, errors.New("database error"))
			},
			expectedNotes: nil,
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &NoteService{
				repo:       mockRepo,
				syncWorker: nil,
			}

			notes, err := service.ListByContext(tt.userID, tt.contextName, tt.limit, tt.offset)

			if tt.expectedError != nil {
				assert.Error(t, err)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
				assert.Nil(t, notes)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedNotes, notes)
			}

			mockRepo.AssertExpectations(t)
		})
	}
}

func TestNoteService_GetSyncStatus(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name             string
		userID           string
		mockSetup        func(*MockRepository)
		expectedStatus   map[string]interface{}
		expectedError    error
	}{
		{
			name:   "Success - With failed and pending notes",
			userID: "user123",
			mockSetup: func(repo *MockRepository) {
				failedNotes := []models.Note{
					{ID: "user123-work-2025-10-18", UserID: "user123", SyncStatus: models.SyncStatusFailed},
				}
				pendingNotes := []database.NoteWithMeta{
					{Note: models.Note{ID: "user123-work-2025-10-17", UserID: "user123", SyncStatus: models.SyncStatusPending}},
					{Note: models.Note{ID: "user456-work-2025-10-17", UserID: "user456", SyncStatus: models.SyncStatusPending}},
				}
				repo.On("GetFailedSyncNotes", "user123", 50).Return(failedNotes, nil)
				repo.On("GetPendingSyncNotes", 50).Return(pendingNotes, nil)
			},
			expectedStatus: map[string]interface{}{
				"pending_count": 1, // Only user123's pending notes
				"failed_count":  1,
				"failed_notes": []models.Note{
					{ID: "user123-work-2025-10-18", UserID: "user123", SyncStatus: models.SyncStatusFailed},
				},
			},
			expectedError: nil,
		},
		{
			name:   "Success - No failed or pending notes",
			userID: "user123",
			mockSetup: func(repo *MockRepository) {
				repo.On("GetFailedSyncNotes", "user123", 50).Return([]models.Note{}, nil)
				repo.On("GetPendingSyncNotes", 50).Return([]database.NoteWithMeta{}, nil)
			},
			expectedStatus: map[string]interface{}{
				"pending_count": 0,
				"failed_count":  0,
				"failed_notes":  []models.Note{},
			},
			expectedError: nil,
		},
		{
			name:   "Error - GetFailedSyncNotes fails",
			userID: "user123",
			mockSetup: func(repo *MockRepository) {
				repo.On("GetFailedSyncNotes", "user123", 50).Return(nil, errors.New("database error"))
			},
			expectedStatus: nil,
			expectedError:  errors.New("database error"),
		},
		{
			name:   "Error - GetPendingSyncNotes fails",
			userID: "user123",
			mockSetup: func(repo *MockRepository) {
				repo.On("GetFailedSyncNotes", "user123", 50).Return([]models.Note{}, nil)
				repo.On("GetPendingSyncNotes", 50).Return(nil, errors.New("database error"))
			},
			expectedStatus: nil,
			expectedError:  errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &NoteService{
				repo:       mockRepo,
				syncWorker: nil,
			}

			status, err := service.GetSyncStatus(tt.userID)

			if tt.expectedError != nil {
				assert.Error(t, err)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
				assert.Nil(t, status)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, status)
				assert.Equal(t, tt.expectedStatus["pending_count"], status["pending_count"])
				assert.Equal(t, tt.expectedStatus["failed_count"], status["failed_count"])
			}

			mockRepo.AssertExpectations(t)
		})
	}

	// Suppress unused variable warning
	_ = now
}

func TestNoteService_RetrySync(t *testing.T) {
	tests := []struct {
		name          string
		noteID        string
		userID        string
		mockSetup     func(*MockRepository)
		expectedError error
	}{
		{
			name:   "Success - Valid note ID and user",
			noteID: "user123-work-2025-10-18",
			userID: "user123",
			mockSetup: func(repo *MockRepository) {
				repo.On("RetrySyncNote", "user123-work-2025-10-18").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:          "Error - Note ID doesn't belong to user",
			noteID:        "user456-work-2025-10-18",
			userID:        "user123",
			mockSetup:     nil, // No repository call expected
			expectedError: ErrUnauthorized,
		},
		{
			name:          "Error - Invalid note ID format (too short)",
			noteID:        "user123",
			userID:        "user123",
			mockSetup:     nil,
			expectedError: ErrUnauthorized,
		},
		{
			name:   "Error - Repository retry fails",
			noteID: "user123-work-2025-10-18",
			userID: "user123",
			mockSetup: func(repo *MockRepository) {
				repo.On("RetrySyncNote", "user123-work-2025-10-18").Return(errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &NoteService{
				repo:       mockRepo,
				syncWorker: nil,
			}

			err := service.RetrySync(tt.noteID, tt.userID)

			if tt.expectedError != nil {
				assert.Error(t, err)
				if errors.Is(tt.expectedError, ErrUnauthorized) {
					assert.ErrorIs(t, err, ErrUnauthorized)
				} else {
					assert.Equal(t, tt.expectedError.Error(), err.Error())
				}
			} else {
				assert.NoError(t, err)
			}

			mockRepo.AssertExpectations(t)
		})
	}
}
