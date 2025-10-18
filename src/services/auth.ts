/**
 * Authentication Module
 * Handles Google OAuth and session management
 */

import { state } from '@/utils/state'
import { api } from './api'
import { events, EVENT } from '@/utils/events'

// Google OAuth types
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient: (config: {
            client_id: string
            scope: string
            ux_mode: string
            callback: (response: { code?: string; error?: string }) => void
          }) => {
            requestCode: () => void
          }
        }
      }
    }
  }
}

interface CodeClient {
  requestCode: () => void
}

interface AuthCodeResponse {
  code?: string
  error?: string
}

class AuthManager {
  private codeClient: CodeClient | null = null
  private initializationPromise: Promise<void> | null = null

  async checkAuth(): Promise<boolean> {
    const data = await api.checkAuth()

    if (data.authenticated && data.user) {
      state.update({
        currentUser: data.user,
        userSettings: data.user.settings || {
          theme: 'dark',
          weekStart: 0,
          timezone: 'UTC',
          dateFormat: 'DD-MM-YY',
          uniqueContextMode: false,
          showBreadcrumb: false,
          showMarkdownEditor: false,
          hideNewContextButton: false
        }
      })
      return true
    }

    return false
  }

  async initGoogleClient(clientId: string): Promise<void> {
    // Return existing initialization promise if already in progress
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    // Return immediately if already initialized
    if (this.codeClient) {
      return Promise.resolve()
    }

    // Create initialization promise
    this.initializationPromise = new Promise((resolve, reject) => {
      // Wait for Google API to be loaded
      const checkGoogleLoaded = () => {
        if (window.google?.accounts?.oauth2) {
          try {
            // Use initCodeClient to get authorization code (which provides refresh token)
            this.codeClient = window.google.accounts.oauth2.initCodeClient({
              client_id: clientId,
              scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
              ux_mode: 'popup',
              callback: (response) => this.handleAuthCodeResponse(response)
            })
            console.log('[AUTH] Google code client initialized successfully')
            resolve()
          } catch (error) {
            console.error('[AUTH] Failed to initialize Google client:', error)
            reject(error)
          }
        } else {
          // Retry after a short delay
          setTimeout(checkGoogleLoaded, 100)
        }
      }

      // Start checking
      checkGoogleLoaded()

      // Set a timeout to prevent infinite waiting
      setTimeout(() => {
        if (!this.codeClient) {
          reject(new Error('Google API failed to load within timeout'))
        }
      }, 10000) // 10 second timeout
    })

    return this.initializationPromise
  }

  async handleAuthCodeResponse(response: AuthCodeResponse): Promise<void> {
    const loader = document.getElementById('landing-loader')

    if (response.error) {
      if (loader) loader.classList.remove('visible')
      events.emit(EVENT.SHOW_ERROR, {
        message: 'OAuth failed: ' + response.error
      })
      return
    }

    if (!response.code) {
      if (loader) loader.classList.remove('visible')
      events.emit(EVENT.SHOW_ERROR, {
        message: 'OAuth failed: No code received'
      })
      return
    }

    try {
      // Send authorization code to backend to exchange for tokens
      const data = await api.loginWithCode(response.code)

      if (data.success && data.user) {
        console.log('[AUTH] Login successful, updating state')
        console.log('[AUTH] Received hasNoContexts:', (data.user as any).hasNoContexts)

        state.update({
          currentUser: data.user,
          userSettings: data.user.settings || {
            theme: 'dark',
            weekStart: 0,
            timezone: 'UTC',
            dateFormat: 'DD-MM-YY',
            uniqueContextMode: false,
            showBreadcrumb: false,
            showMarkdownEditor: false,
            hideNewContextButton: false
          }
        })

        console.log('[AUTH] Emitting auth-success event')
        // Emit event for UI to react (loader will be hidden by showApp)
        events.emit('auth-success' as any, {})
      } else {
        if (loader) loader.classList.remove('visible')
        events.emit(EVENT.SHOW_ERROR, {
          message: data.error || 'Login failed'
        })
      }
    } catch (error) {
      if (loader) loader.classList.remove('visible')
      const message = error instanceof Error ? error.message : 'Unknown error'
      events.emit(EVENT.SHOW_ERROR, {
        message: 'Login failed: ' + message
      })
    }
  }

  async signIn(): Promise<void> {
    // Show loading indicator immediately
    const loader = document.getElementById('landing-loader')
    if (loader) loader.classList.add('visible')

    try {
      // Wait for initialization to complete if not already done
      await this.initializationPromise

      if (!this.codeClient) {
        throw new Error('Google client not initialized')
      }

      // Request authorization code (will trigger popup)
      this.codeClient.requestCode()
    } catch (error) {
      console.error('[AUTH] Sign in failed:', error)
      if (loader) loader.classList.remove('visible')
      events.emit(EVENT.SHOW_ERROR, {
        message: 'Failed to initialize Google sign-in. Please refresh the page.'
      })
    }
  }

  signOut(): void {
    console.log('[AUTH] Starting logout...')

    // Call logout endpoint (don't wait for response)
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    })
      .then(() => {
        console.log('[AUTH] Logout endpoint called')
      })
      .catch(err => {
        console.error('[AUTH] Logout endpoint error:', err)
      })

    // Clear localStorage and sessionStorage
    console.log('[AUTH] Clearing storage...')
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch (e) {
      console.error('[AUTH] Storage clear error:', e)
    }

    // Force reload immediately
    console.log('[AUTH] Forcing reload...')
    setTimeout(() => {
      window.location.href = '/'
      // Fallback in case href doesn't work
      setTimeout(() => window.location.reload(), 100)
    }, 50)
  }

  async clearAllCaches(): Promise<void> {
    try {
      // Clear IndexedDB
      const dbName = 'DailyNotesDB'
      const deleteRequest = indexedDB.deleteDatabase(dbName)

      await new Promise<void>((resolve) => {
        deleteRequest.onsuccess = () => {
          console.log('[AUTH] IndexedDB cleared')
          resolve()
        }
        deleteRequest.onerror = () => {
          console.warn('[AUTH] Failed to clear IndexedDB')
          resolve() // Continue even if this fails
        }
      })

      // Clear all Service Worker caches
      if ('caches' in window) {
        const cacheNames = await caches.keys()
        await Promise.all(
          cacheNames.map(cacheName => {
            console.log('[AUTH] Deleting cache:', cacheName)
            return caches.delete(cacheName)
          })
        )
        console.log('[AUTH] All Service Worker caches cleared')
      }

      // Clear localStorage and sessionStorage
      localStorage.clear()
      sessionStorage.clear()
      console.log('[AUTH] Storage cleared')
    } catch (error) {
      console.error('[AUTH] Error clearing caches:', error)
      // Don't throw - we still want to complete logout
    }
  }
}

export const auth = new AuthManager()

// Expose auth functions globally for onclick handlers in HTML
if (typeof window !== 'undefined') {
  (window as any).signInWithGoogle = () => auth.signIn()
}
