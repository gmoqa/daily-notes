package drive

import (
	"context"
	"daily-notes/config"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

// Client wraps the Google Drive API client and handles authentication
type Client struct {
	service     *drive.Service
	tokenSource oauth2.TokenSource
	userID      string
}

// NewClient creates a new Drive client with the given OAuth token
func NewClient(ctx context.Context, token *oauth2.Token, userID string) (*Client, error) {
	oauthConfig := &oauth2.Config{
		ClientID:     config.AppConfig.GoogleClientID,
		ClientSecret: config.AppConfig.GoogleClientSecret,
		RedirectURL:  config.AppConfig.GoogleRedirectURL,
		Scopes:       []string{drive.DriveFileScope},
		Endpoint:     google.Endpoint,
	}

	// Create a token source that will automatically refresh the token
	tokenSource := oauthConfig.TokenSource(ctx, token)
	httpClient := oauth2.NewClient(ctx, tokenSource)

	srv, err := drive.NewService(ctx, option.WithHTTPClient(httpClient))
	if err != nil {
		return nil, err
	}

	return &Client{
		service:     srv,
		tokenSource: tokenSource,
		userID:      userID,
	}, nil
}

// GetCurrentToken returns the current (possibly refreshed) OAuth token
func (c *Client) GetCurrentToken() (*oauth2.Token, error) {
	return c.tokenSource.Token()
}

// UserID returns the user ID associated with this client
func (c *Client) UserID() string {
	return c.userID
}

// Service returns the underlying Google Drive service for direct API access
func (c *Client) Service() *drive.Service {
	return c.service
}
