/**
 * Authentication Module
 * Handles Google OAuth and session management
 */

import { state } from '@/utils/state'
import { api } from './api'
import { events, EVENT } from '@/utils/events'

class AuthManager {
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

  async initGoogleClient(_clientId: string): Promise<void> {
    // No initialization needed for OAuth redirect flow
    // Just return immediately
    console.log('[AUTH] OAuth redirect flow - no initialization needed')
    return Promise.resolve()
  }

  async signIn(): Promise<void> {
    console.log('[AUTH] Redirecting to OAuth flow...')

    // Simply redirect to the OAuth endpoint
    // The backend will handle the redirect to Google
    window.location.href = '/auth/google'
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
