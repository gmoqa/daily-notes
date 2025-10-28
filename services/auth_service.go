package services

import (
	"context"
	"daily-notes/config"
	"daily-notes/models"
	"encoding/json"
	"net/http"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/idtoken"
)

// AuthService handles authentication business logic
type AuthService struct {
	repo           AuthRepository
	sessionStore   SessionStore
	syncWorker     SyncWorker
	storageFactory StorageFactory
}

// NewAuthService creates a new auth service
func NewAuthService(repo AuthRepository, sessionStore SessionStore, syncWorker SyncWorker, storageFactory StorageFactory) *AuthService {
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
	// Force access_type=offline to ensure we get refresh tokens
	token, err := oauthConfig.Exchange(ctx, code, oauth2.AccessTypeOffline)
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

// LoginWithIDToken handles login via Google One Tap ID token
func (as *AuthService) LoginWithIDToken(idToken string) (*LoginResponse, error) {
	ctx := context.Background()

	// Validate the ID token
	payload, err := idtoken.Validate(ctx, idToken, config.AppConfig.GoogleClientID)
	if err != nil {
		return nil, ErrInvalidToken
	}

	// Extract user info from ID token
	email, _ := payload.Claims["email"].(string)
	name, _ := payload.Claims["name"].(string)
	picture, _ := payload.Claims["picture"].(string)
	googleID := payload.Subject

	if googleID == "" || email == "" {
		return nil, ErrInvalidUserInfo
	}

	userInfo := &UserInfo{
		GoogleID: googleID,
		Email:    email,
		Name:     name,
		Picture:  picture,
	}

	// For One Tap, we don't have Drive access by default, so use default settings
	defaultSettings := models.UserSettings{
		Theme:      "dark",
		WeekStart:  0,
		Timezone:   "UTC",
		DateFormat: "DD-MM-YY",
	}

	// Create or update user
	if err := as.createOrUpdateUser(userInfo, defaultSettings); err != nil {
		return nil, err
	}

	// Create session (no tokens for One Tap - user would need to authorize for Drive access separately)
	sess, err := as.sessionStore.Create(
		userInfo.GoogleID,
		userInfo.Email,
		userInfo.Name,
		userInfo.Picture,
		"", // No access token
		"", // No refresh token
		time.Now().Add(30*24*time.Hour), // Session expires in 30 days
		defaultSettings,
	)
	if err != nil {
		return nil, err
	}

	// Check if this is first login
	hasNoContexts := as.checkFirstLogin(userInfo.GoogleID)

	return &LoginResponse{
		Session:       sess,
		HasNoContexts: hasNoContexts,
		Token:         nil,
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

// RefreshTokenIfNeeded checks if the access token is expiring soon and refreshes it if needed
// Returns the updated token or the original if no refresh was needed
func (as *AuthService) RefreshTokenIfNeeded(session *models.Session) (interface{}, error) {
	// If token expires in less than 5 minutes, refresh it
	if time.Until(session.TokenExpiry) > 5*time.Minute {
		// Token is still valid, return current token
		return &oauth2.Token{
			AccessToken:  session.AccessToken,
			RefreshToken: session.RefreshToken,
			Expiry:       session.TokenExpiry,
		}, nil
	}

	// Token is expiring soon or expired, refresh it
	if session.RefreshToken == "" {
		return nil, ErrNoRefreshToken
	}

	ctx := context.Background()
	oauthConfig := &oauth2.Config{
		ClientID:     config.AppConfig.GoogleClientID,
		ClientSecret: config.AppConfig.GoogleClientSecret,
		Endpoint:     google.Endpoint,
	}

	// Create token with refresh token
	oldToken := &oauth2.Token{
		AccessToken:  session.AccessToken,
		RefreshToken: session.RefreshToken,
		Expiry:       session.TokenExpiry,
	}

	// Get new token using refresh token
	tokenSource := oauthConfig.TokenSource(ctx, oldToken)
	newToken, err := tokenSource.Token()
	if err != nil {
		return nil, ErrTokenRefreshFailed
	}

	// Update session with new tokens
	if err := as.sessionStore.UpdateUserToken(
		session.UserID,
		newToken.AccessToken,
		newToken.RefreshToken,
		newToken.Expiry,
	); err != nil {
		// Log error but return the new token anyway
		// The token is still usable even if we couldn't save it
	}

	// Update the session object
	session.AccessToken = newToken.AccessToken
	session.RefreshToken = newToken.RefreshToken
	session.TokenExpiry = newToken.Expiry

	return newToken, nil
}

// HandlePostLogin performs post-login operations like importing from Drive
func (as *AuthService) HandlePostLogin(loginResponse *LoginResponse) {
	// Check if we have a valid token (nil for One Tap login)
	if loginResponse.Token == nil {
		return
	}

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
