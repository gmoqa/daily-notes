package services

import (
	"context"
	"daily-notes/config"
	"daily-notes/database"
	"daily-notes/models"
	"daily-notes/session"
	"daily-notes/storage"
	"encoding/json"
	"net/http"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// SyncWorker interface for drive operations
type SyncWorker interface {
	ImportFromDrive(userID string, token *oauth2.Token) error
}

// AuthService handles authentication business logic
type AuthService struct {
	repo           *database.Repository
	sessionStore   *session.Store
	syncWorker     SyncWorker
	storageFactory storage.Factory
}

// NewAuthService creates a new auth service
func NewAuthService(repo *database.Repository, sessionStore *session.Store, syncWorker SyncWorker, storageFactory storage.Factory) *AuthService {
	return &AuthService{
		repo:           repo,
		sessionStore:   sessionStore,
		syncWorker:     syncWorker,
		storageFactory: storageFactory,
	}
}

// UserInfo represents user information from Google
type UserInfo struct {
	GoogleID string
	Email    string
	Name     string
	Picture  string
}

// LoginResponse contains the session and additional login metadata
type LoginResponse struct {
	Session       *models.Session
	HasNoContexts bool
	Token         *oauth2.Token
}

// LoginWithCode handles login via OAuth authorization code
func (as *AuthService) LoginWithCode(code string) (*LoginResponse, error) {
	ctx := context.Background()
	oauthConfig := &oauth2.Config{
		ClientID:     config.AppConfig.GoogleClientID,
		ClientSecret: config.AppConfig.GoogleClientSecret,
		RedirectURL:  config.AppConfig.GoogleRedirectURL,
		Scopes: []string{
			"https://www.googleapis.com/auth/drive.file",
			"https://www.googleapis.com/auth/userinfo.email",
		},
		Endpoint: google.Endpoint,
	}

	// Exchange authorization code for tokens
	token, err := oauthConfig.Exchange(ctx, code)
	if err != nil {
		return nil, ErrInvalidAuthCode
	}

	// Get user info
	userInfo, err := as.getUserInfo(token.AccessToken)
	if err != nil {
		return nil, err
	}

	// Get user settings from Drive
	userSettings := as.getUserSettings(token, userInfo.GoogleID)

	// Create or update user
	if err := as.createOrUpdateUser(userInfo, userSettings); err != nil {
		return nil, err
	}

	// Create session
	sess, err := as.sessionStore.Create(
		userInfo.GoogleID,
		userInfo.Email,
		userInfo.Name,
		userInfo.Picture,
		token.AccessToken,
		token.RefreshToken,
		token.Expiry,
		userSettings,
	)
	if err != nil {
		return nil, err
	}

	// Check if this is first login by checking if user has any contexts
	hasNoContexts := as.checkFirstLogin(userInfo.GoogleID)

	// Return login response with metadata
	return &LoginResponse{
		Session:       sess,
		HasNoContexts: hasNoContexts,
		Token:         token,
	}, nil
}

// LoginWithToken handles login via direct access token (legacy)
func (as *AuthService) LoginWithToken(accessToken, refreshToken string, expiresIn int64) (*LoginResponse, error) {
	tokenExpiry := time.Now().Add(1 * time.Hour)
	if expiresIn > 0 {
		tokenExpiry = time.Now().Add(time.Duration(expiresIn) * time.Second)
	}

	token := &oauth2.Token{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		Expiry:       tokenExpiry,
	}

	// Validate and get user info
	userInfo, err := as.getUserInfo(accessToken)
	if err != nil {
		return nil, err
	}

	// Get user settings from Drive
	userSettings := as.getUserSettings(token, userInfo.GoogleID)

	// Create or update user
	if err := as.createOrUpdateUser(userInfo, userSettings); err != nil {
		return nil, err
	}

	// Create session
	sess, err := as.sessionStore.Create(
		userInfo.GoogleID,
		userInfo.Email,
		userInfo.Name,
		userInfo.Picture,
		accessToken,
		refreshToken,
		tokenExpiry,
		userSettings,
	)
	if err != nil {
		return nil, err
	}

	// Check if this is first login
	hasNoContexts := as.checkFirstLogin(userInfo.GoogleID)

	// Return login response with metadata
	return &LoginResponse{
		Session:       sess,
		HasNoContexts: hasNoContexts,
		Token:         token,
	}, nil
}

// Logout handles user logout
func (as *AuthService) Logout(sessionID string) error {
	return as.sessionStore.Delete(sessionID)
}

// GetSessionInfo returns current session information
func (as *AuthService) GetSessionInfo(sessionID string) (*models.Session, error) {
	sess, err := as.sessionStore.Get(sessionID)
	if err != nil || sess == nil {
		return nil, ErrSessionNotFound
	}
	return sess, nil
}

// getUserInfo fetches user information from Google
func (as *AuthService) getUserInfo(accessToken string) (*UserInfo, error) {
	userInfoURL := "https://www.googleapis.com/oauth2/v3/userinfo"
	req, err := http.NewRequest("GET", userInfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, ErrInvalidToken
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, ErrInvalidToken
	}

	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, ErrInvalidToken
	}

	googleID, _ := data["sub"].(string)
	email, _ := data["email"].(string)
	name, _ := data["name"].(string)
	picture, _ := data["picture"].(string)

	if googleID == "" || email == "" {
		return nil, ErrInvalidUserInfo
	}

	return &UserInfo{
		GoogleID: googleID,
		Email:    email,
		Name:     name,
		Picture:  picture,
	}, nil
}

// getUserSettings fetches user settings from cloud storage
func (as *AuthService) getUserSettings(token *oauth2.Token, userID string) models.UserSettings {
	defaultSettings := models.UserSettings{
		Theme:      "dark",
		WeekStart:  0,
		Timezone:   "UTC",
		DateFormat: "DD-MM-YY",
	}

	if token.AccessToken == "" {
		return defaultSettings
	}

	provider, err := as.storageFactory(context.Background(), token, userID)
	if err != nil {
		return defaultSettings
	}

	settings, err := provider.GetSettings()
	if err != nil {
		return defaultSettings
	}

	return settings
}

// createOrUpdateUser saves or updates user in database
func (as *AuthService) createOrUpdateUser(userInfo *UserInfo, settings models.UserSettings) error {
	user := &models.User{
		ID:          userInfo.GoogleID,
		GoogleID:    userInfo.GoogleID,
		Email:       userInfo.Email,
		Name:        userInfo.Name,
		Picture:     userInfo.Picture,
		Settings:    settings,
		CreatedAt:   time.Now(),
		LastLoginAt: time.Now(),
	}

	return as.repo.UpsertUser(user)
}

// checkFirstLogin checks if user has any contexts (returns true if no contexts)
func (as *AuthService) checkFirstLogin(userID string) bool {
	contexts, err := as.repo.GetContexts(userID)
	return err == nil && len(contexts) == 0
}

// HandlePostLogin performs post-login operations like importing from Drive
func (as *AuthService) HandlePostLogin(loginResponse *LoginResponse) {
	// If user has no contexts and has a valid token, import from Drive in background
	if loginResponse.HasNoContexts && as.syncWorker != nil && loginResponse.Token.AccessToken != "" {
		go func() {
			userID := loginResponse.Session.UserID
			if err := as.syncWorker.ImportFromDrive(userID, loginResponse.Token); err != nil {
				// Log error but don't fail the login
				// The error is already logged in the SyncWorker
			}
		}()
	}

	// Cleanup old deleted folders in background
	if loginResponse.Token.AccessToken != "" {
		go func() {
			provider, err := as.storageFactory(context.Background(), loginResponse.Token, loginResponse.Session.UserID)
			if err == nil {
				_ = provider.CleanupOldDeletedFolders()
			}
		}()
	}
}
