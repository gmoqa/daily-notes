package services

import (
	"context"
	"daily-notes/models"
	"daily-notes/storage/drive"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"golang.org/x/oauth2"
)

// ==================== MOCKS ====================

// MockContextRepository is a mock implementation of ContextRepository interface
type MockContextRepository struct {
	mock.Mock
}

// Ensure MockContextRepository implements ContextRepository interface
var _ ContextRepository = (*MockContextRepository)(nil)

func (m *MockContextRepository) GetContexts(userID string) ([]models.Context, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]models.Context), args.Error(1)
}

func (m *MockContextRepository) GetContextByName(userID, name string) (*models.Context, error) {
	args := m.Called(userID, name)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Context), args.Error(1)
}

func (m *MockContextRepository) GetContextByID(contextID string) (*models.Context, error) {
	args := m.Called(contextID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Context), args.Error(1)
}

func (m *MockContextRepository) CreateContext(ctx *models.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *MockContextRepository) UpdateContext(contextID, name, color string) error {
	args := m.Called(contextID, name, color)
	return args.Error(0)
}

func (m *MockContextRepository) UpdateNotesContextName(oldName, newName, userID string) error {
	args := m.Called(oldName, newName, userID)
	return args.Error(0)
}

func (m *MockContextRepository) DeleteContext(contextID string) error {
	args := m.Called(contextID)
	return args.Error(0)
}

func (m *MockContextRepository) GetNotesByContext(userID, contextName string, limit, offset int) ([]models.Note, error) {
	args := m.Called(userID, contextName, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]models.Note), args.Error(1)
}

func (m *MockContextRepository) DeleteNote(userID, contextName, date string) error {
	args := m.Called(userID, contextName, date)
	return args.Error(0)
}

// MockStorageService is a mock implementation of StorageService interface
type MockStorageService struct {
	mock.Mock
}

var _ StorageService = (*MockStorageService)(nil)

// Note operations
func (m *MockStorageService) UpsertNote(contextName, date, content string) (*models.Note, error) {
	args := m.Called(contextName, date, content)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Note), args.Error(1)
}

func (m *MockStorageService) DeleteNote(contextName, date string) error {
	args := m.Called(contextName, date)
	return args.Error(0)
}

func (m *MockStorageService) GetAllNotesInContext(contextName string) ([]models.Note, error) {
	args := m.Called(contextName)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]models.Note), args.Error(1)
}

// Context operations
func (m *MockStorageService) GetContexts() ([]models.Context, error) {
	args := m.Called()
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]models.Context), args.Error(1)
}

func (m *MockStorageService) RenameContext(contextID, oldName, newName string) error {
	args := m.Called(contextID, oldName, newName)
	return args.Error(0)
}

func (m *MockStorageService) DeleteContext(contextID, contextName string) error {
	args := m.Called(contextID, contextName)
	return args.Error(0)
}

// Settings operations
func (m *MockStorageService) GetSettings() (models.UserSettings, error) {
	args := m.Called()
	return args.Get(0).(models.UserSettings), args.Error(1)
}

// Config operations
func (m *MockStorageService) GetConfig() (*drive.Config, error) {
	args := m.Called()
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*drive.Config), args.Error(1)
}

// Utility operations
func (m *MockStorageService) GetCurrentToken() (*oauth2.Token, error) {
	args := m.Called()
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*oauth2.Token), args.Error(1)
}

func (m *MockStorageService) CleanupOldDeletedFolders() error {
	args := m.Called()
	return args.Error(0)
}

// ==================== TESTS ====================

func TestContextService_List(t *testing.T) {
	tests := []struct {
		name             string
		userID           string
		mockSetup        func(*MockContextRepository)
		expectedContexts []models.Context
		expectedError    error
	}{
		{
			name:   "Success - Returns contexts",
			userID: "user123",
			mockSetup: func(repo *MockContextRepository) {
				contexts := []models.Context{
					{ID: "ctx1", UserID: "user123", Name: "work", Color: "primary"},
					{ID: "ctx2", UserID: "user123", Name: "personal", Color: "info"},
				}
				repo.On("GetContexts", "user123").Return(contexts, nil)
			},
			expectedContexts: []models.Context{
				{ID: "ctx1", UserID: "user123", Name: "work", Color: "primary"},
				{ID: "ctx2", UserID: "user123", Name: "personal", Color: "info"},
			},
			expectedError: nil,
		},
		{
			name:   "Success - Empty list",
			userID: "user123",
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContexts", "user123").Return([]models.Context{}, nil)
			},
			expectedContexts: []models.Context{},
			expectedError:    nil,
		},
		{
			name:   "Error - Repository error",
			userID: "user123",
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContexts", "user123").Return(nil, errors.New("database error"))
			},
			expectedContexts: nil,
			expectedError:    errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockContextRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &ContextService{
				repo:           mockRepo,
				storageFactory: nil,
			}

			contexts, err := service.List(tt.userID)

			if tt.expectedError != nil {
				assert.Error(t, err)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
				assert.Nil(t, contexts)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedContexts, contexts)
			}

			mockRepo.AssertExpectations(t)
		})
	}
}

func TestContextService_Create(t *testing.T) {
	tests := []struct {
		name          string
		userID        string
		contextName   string
		color         string
		mockSetup     func(*MockContextRepository)
		expectedError error
		validateFunc  func(*testing.T, *models.Context)
	}{
		{
			name:        "Success - Create context with color",
			userID:      "user123",
			contextName: "work",
			color:       "primary",
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByName", "user123", "work").Return(nil, nil)
				repo.On("CreateContext", mock.AnythingOfType("*models.Context")).Return(nil)
			},
			expectedError: nil,
			validateFunc: func(t *testing.T, ctx *models.Context) {
				assert.Equal(t, "user123", ctx.UserID)
				assert.Equal(t, "work", ctx.Name)
				assert.Equal(t, "primary", ctx.Color)
				assert.NotEmpty(t, ctx.ID)
			},
		},
		{
			name:        "Success - Create context with default color",
			userID:      "user123",
			contextName: "personal",
			color:       "",
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByName", "user123", "personal").Return(nil, nil)
				repo.On("CreateContext", mock.AnythingOfType("*models.Context")).Return(nil)
			},
			expectedError: nil,
			validateFunc: func(t *testing.T, ctx *models.Context) {
				assert.Equal(t, "primary", ctx.Color) // Default color
			},
		},
		{
			name:        "Success - Trim whitespace from name",
			userID:      "user123",
			contextName: "  work  ",
			color:       "info",
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByName", "user123", "work").Return(nil, nil)
				repo.On("CreateContext", mock.AnythingOfType("*models.Context")).Return(nil)
			},
			expectedError: nil,
			validateFunc: func(t *testing.T, ctx *models.Context) {
				assert.Equal(t, "work", ctx.Name) // Trimmed
			},
		},
		{
			name:        "Error - Context already exists",
			userID:      "user123",
			contextName: "work",
			color:       "primary",
			mockSetup: func(repo *MockContextRepository) {
				existing := &models.Context{ID: "ctx1", Name: "work"}
				repo.On("GetContextByName", "user123", "work").Return(existing, nil)
			},
			expectedError: ErrContextAlreadyExists,
		},
		{
			name:        "Error - Repository GetContextByName fails",
			userID:      "user123",
			contextName: "work",
			color:       "primary",
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByName", "user123", "work").Return(nil, errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
		{
			name:        "Error - Repository CreateContext fails",
			userID:      "user123",
			contextName: "work",
			color:       "primary",
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByName", "user123", "work").Return(nil, nil)
				repo.On("CreateContext", mock.AnythingOfType("*models.Context")).Return(errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockContextRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &ContextService{
				repo:           mockRepo,
				storageFactory: nil,
			}

			ctx, err := service.Create(tt.userID, tt.contextName, tt.color)

			if tt.expectedError != nil {
				assert.Error(t, err)
				if errors.Is(tt.expectedError, ErrContextAlreadyExists) {
					assert.ErrorIs(t, err, ErrContextAlreadyExists)
				} else {
					assert.Equal(t, tt.expectedError.Error(), err.Error())
				}
				assert.Nil(t, ctx)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, ctx)
				if tt.validateFunc != nil {
					tt.validateFunc(t, ctx)
				}
			}

			mockRepo.AssertExpectations(t)
		})
	}
}

func TestContextService_Update(t *testing.T) {
	tests := []struct {
		name           string
		contextID      string
		newName        string
		color          string
		userID         string
		token          *oauth2.Token
		mockRepoSetup  func(*MockContextRepository)
		mockStorageSetup func(*MockStorageService)
		expectedError  error
	}{
		{
			name:      "Success - Update context without name change",
			contextID: "ctx1",
			newName:   "work",
			color:     "danger",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				oldCtx := &models.Context{ID: "ctx1", Name: "work", Color: "primary"}
				repo.On("GetContextByID", "ctx1").Return(oldCtx, nil)
				repo.On("UpdateContext", "ctx1", "work", "danger").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:      "Success - Update context with name change",
			contextID: "ctx1",
			newName:   "projects",
			color:     "info",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				oldCtx := &models.Context{ID: "ctx1", Name: "work", Color: "primary"}
				repo.On("GetContextByID", "ctx1").Return(oldCtx, nil)
				repo.On("UpdateContext", "ctx1", "projects", "info").Return(nil)
				repo.On("UpdateNotesContextName", "work", "projects", "user123").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:      "Success - Trim whitespace",
			contextID: "ctx1",
			newName:   "  work  ",
			color:     "primary",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				oldCtx := &models.Context{ID: "ctx1", Name: "work", Color: "info"}
				repo.On("GetContextByID", "ctx1").Return(oldCtx, nil)
				repo.On("UpdateContext", "ctx1", "work", "primary").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:      "Success - Default color if empty",
			contextID: "ctx1",
			newName:   "work",
			color:     "",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				oldCtx := &models.Context{ID: "ctx1", Name: "work", Color: "info"}
				repo.On("GetContextByID", "ctx1").Return(oldCtx, nil)
				repo.On("UpdateContext", "ctx1", "work", "primary").Return(nil) // Default color
			},
			expectedError: nil,
		},
		{
			name:      "Error - Context not found",
			contextID: "ctx1",
			newName:   "work",
			color:     "primary",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByID", "ctx1").Return(nil, nil)
			},
			expectedError: ErrContextNotFound,
		},
		{
			name:      "Error - GetContextByID fails",
			contextID: "ctx1",
			newName:   "work",
			color:     "primary",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByID", "ctx1").Return(nil, errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
		{
			name:      "Error - UpdateContext fails",
			contextID: "ctx1",
			newName:   "work",
			color:     "primary",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				oldCtx := &models.Context{ID: "ctx1", Name: "work", Color: "info"}
				repo.On("GetContextByID", "ctx1").Return(oldCtx, nil)
				repo.On("UpdateContext", "ctx1", "work", "primary").Return(errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
		{
			name:      "Error - UpdateNotesContextName fails",
			contextID: "ctx1",
			newName:   "projects",
			color:     "info",
			userID:    "user123",
			token:     nil,
			mockRepoSetup: func(repo *MockContextRepository) {
				oldCtx := &models.Context{ID: "ctx1", Name: "work", Color: "primary"}
				repo.On("GetContextByID", "ctx1").Return(oldCtx, nil)
				repo.On("UpdateContext", "ctx1", "projects", "info").Return(nil)
				repo.On("UpdateNotesContextName", "work", "projects", "user123").Return(errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockContextRepository)
			if tt.mockRepoSetup != nil {
				tt.mockRepoSetup(mockRepo)
			}

			var storageFactory StorageFactory
			if tt.mockStorageSetup != nil {
				mockProvider := new(MockStorageService)
				tt.mockStorageSetup(mockProvider)
				storageFactory = func(ctx context.Context, token *oauth2.Token, userID string) (StorageService, error) {
					return mockProvider, nil
				}
			}

			service := &ContextService{
				repo:           mockRepo,
				storageFactory: storageFactory,
			}

			err := service.Update(tt.contextID, tt.newName, tt.color, tt.userID, tt.token)

			if tt.expectedError != nil {
				assert.Error(t, err)
				if errors.Is(tt.expectedError, ErrContextNotFound) {
					assert.ErrorIs(t, err, ErrContextNotFound)
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

func TestContextService_Delete(t *testing.T) {
	tests := []struct {
		name          string
		contextID     string
		userID        string
		token         *oauth2.Token
		mockSetup     func(*MockContextRepository)
		expectedError error
	}{
		{
			name:      "Success - Delete context with no notes",
			contextID: "ctx1",
			userID:    "user123",
			token:     nil,
			mockSetup: func(repo *MockContextRepository) {
				ctx := &models.Context{ID: "ctx1", Name: "work"}
				repo.On("GetContextByID", "ctx1").Return(ctx, nil)
				repo.On("GetNotesByContext", "user123", "work", 1000, 0).Return([]models.Note{}, nil)
				repo.On("DeleteContext", "ctx1").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:      "Success - Delete context with notes",
			contextID: "ctx1",
			userID:    "user123",
			token:     nil,
			mockSetup: func(repo *MockContextRepository) {
				ctx := &models.Context{ID: "ctx1", Name: "work"}
				notes := []models.Note{
					{ID: "note1", Date: "2025-10-18"},
					{ID: "note2", Date: "2025-10-17"},
				}
				repo.On("GetContextByID", "ctx1").Return(ctx, nil)
				repo.On("GetNotesByContext", "user123", "work", 1000, 0).Return(notes, nil)
				repo.On("DeleteNote", "user123", "work", "2025-10-18").Return(nil)
				repo.On("DeleteNote", "user123", "work", "2025-10-17").Return(nil)
				repo.On("DeleteContext", "ctx1").Return(nil)
			},
			expectedError: nil,
		},
		{
			name:      "Success - Continue deleting even if individual note deletion fails",
			contextID: "ctx1",
			userID:    "user123",
			token:     nil,
			mockSetup: func(repo *MockContextRepository) {
				ctx := &models.Context{ID: "ctx1", Name: "work"}
				notes := []models.Note{
					{ID: "note1", Date: "2025-10-18"},
					{ID: "note2", Date: "2025-10-17"},
				}
				repo.On("GetContextByID", "ctx1").Return(ctx, nil)
				repo.On("GetNotesByContext", "user123", "work", 1000, 0).Return(notes, nil)
				repo.On("DeleteNote", "user123", "work", "2025-10-18").Return(errors.New("note error"))
				repo.On("DeleteNote", "user123", "work", "2025-10-17").Return(nil)
				repo.On("DeleteContext", "ctx1").Return(nil)
			},
			expectedError: nil, // Should still succeed
		},
		{
			name:      "Error - Context not found",
			contextID: "ctx1",
			userID:    "user123",
			token:     nil,
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByID", "ctx1").Return(nil, nil)
			},
			expectedError: ErrContextNotFound,
		},
		{
			name:      "Error - GetContextByID fails",
			contextID: "ctx1",
			userID:    "user123",
			token:     nil,
			mockSetup: func(repo *MockContextRepository) {
				repo.On("GetContextByID", "ctx1").Return(nil, errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
		{
			name:      "Error - GetNotesByContext fails",
			contextID: "ctx1",
			userID:    "user123",
			token:     nil,
			mockSetup: func(repo *MockContextRepository) {
				ctx := &models.Context{ID: "ctx1", Name: "work"}
				repo.On("GetContextByID", "ctx1").Return(ctx, nil)
				repo.On("GetNotesByContext", "user123", "work", 1000, 0).Return(nil, errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
		{
			name:      "Error - DeleteContext fails",
			contextID: "ctx1",
			userID:    "user123",
			token:     nil,
			mockSetup: func(repo *MockContextRepository) {
				ctx := &models.Context{ID: "ctx1", Name: "work"}
				repo.On("GetContextByID", "ctx1").Return(ctx, nil)
				repo.On("GetNotesByContext", "user123", "work", 1000, 0).Return([]models.Note{}, nil)
				repo.On("DeleteContext", "ctx1").Return(errors.New("database error"))
			},
			expectedError: errors.New("database error"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := new(MockContextRepository)
			if tt.mockSetup != nil {
				tt.mockSetup(mockRepo)
			}

			service := &ContextService{
				repo:           mockRepo,
				storageFactory: nil,
			}

			err := service.Delete(tt.contextID, tt.userID, tt.token)

			if tt.expectedError != nil {
				assert.Error(t, err)
				if errors.Is(tt.expectedError, ErrContextNotFound) {
					assert.ErrorIs(t, err, ErrContextNotFound)
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
