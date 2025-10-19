package sync

import (
	"log"

	"golang.org/x/oauth2"
)

// ==================== TOKEN REFRESH MANAGEMENT ====================

// updateTokenIfRefreshed checks if the OAuth token was refreshed during a storage operation
// and updates it in the session store if it changed
func (w *Worker) updateTokenIfRefreshed(provider StorageService, originalToken *oauth2.Token, userID string, logPrefix string) {
	// Get current token from provider
	currentToken, err := provider.GetCurrentToken()
	if err != nil || currentToken == nil {
		return
	}

	// Only update if the token actually changed
	if currentToken.AccessToken != originalToken.AccessToken || !currentToken.Expiry.Equal(originalToken.Expiry) {
		log.Printf("[%s] Token was refreshed for user %s, updating session", logPrefix, userID)
		if w.sessionStore != nil {
			if err := w.sessionStore.UpdateUserToken(userID, currentToken.AccessToken, currentToken.RefreshToken, currentToken.Expiry); err != nil {
				log.Printf("[%s] Failed to update token in session: %v", logPrefix, err)
			}
		}
	}
}
