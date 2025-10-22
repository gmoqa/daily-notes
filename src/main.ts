/**
 * Main Application Entry Point
 * Initializes and coordinates all modules
 */

import { state } from '@utils/state'
import { cache } from '@utils/cache'
import { events, EVENT } from '@utils/events'
import { SyncQueue } from '@utils/sync'
import { api } from '@services/api'
import { auth } from '@services/auth'
import { notes } from '@services/notes'
import { contexts } from '@services/contexts'
import { calendar } from '@components/Calendar'
import { markdownEditor } from '@components/Editor'
import { notifications } from '@components/Notifications'
import { ui } from '@components/UI'

declare global {
  interface Window {
    __APP__?: Application
    __GOOGLE_CLIENT_ID__?: string
    __DEBUG__?: any
  }
}

class Application {
  private syncQueue: SyncQueue | null = null

  async init(googleClientId: string): Promise<void> {
    console.log('[MAIN] Initializing with client ID:', googleClientId)

    // Initialize cache
    try {
      await cache.init()
      console.log('Cache initialized')
    } catch (err) {
      console.warn('IndexedDB not available', err)
    }

    // Initialize sync queue
    this.syncQueue = new SyncQueue(api)

    // Setup event handlers
    this.setupEventHandlers()

    // Initialize UI Manager
    ui.init()

    // Initialize Markdown Editor
    await markdownEditor.init(
      'markdown-editor-container',
      (content: string) => {
        notes.handleNoteInput(content)
      },
      async (content: string) => {
        await notes.handleFlush(content)
      }
    )

    // Check authentication
    const isAuthenticated = await auth.checkAuth()

    if (isAuthenticated) {
      await this.showApp()
    } else {
      // Hide app and show auth section
      const appSection = document.getElementById('app-section')
      const authSection = document.getElementById('auth-section')
      if (appSection) appSection.classList.remove('visible')
      if (authSection) authSection.classList.add('visible')
    }

    // Make body visible after determining which section to show
    document.body.classList.add('loaded')

    // Initialize Google OAuth client (async, will wait for script to load)
    auth.initGoogleClient(googleClientId).catch(error => {
      console.error('[MAIN] Failed to initialize Google client:', error)
    })
  }

  private setupEventHandlers(): void {
    // beforeunload: Save any pending changes before page closes/reloads
    window.addEventListener('beforeunload', (e) => {
      console.log('[MAIN] beforeunload - flushing editor and cache...')

      // Force flush editor synchronously (best effort)
      // Note: Can't use async/await here as beforeunload has time constraints
      const context = state.get('selectedContext')
      const date = state.get('selectedDate')

      if (context && date && markdownEditor) {
        try {
          // Get current editor content
          const content = markdownEditor.getContent()

          // Save to cache synchronously if possible
          const now = new Date().toISOString()
          const note = {
            context,
            date,
            content,
            updated_at: now
          }

          // Use IndexedDB sync API if available (won't work in all browsers)
          // Most modern browsers will keep the page open long enough for this
          cache.saveNoteImmediate(note as any).catch(err => {
            console.error('[MAIN] Failed to save on beforeunload:', err)
          })
        } catch (error) {
          console.error('[MAIN] Error in beforeunload handler:', error)
        }
      }

      // Don't show confirmation dialog
      // delete e.returnValue
    })

    // Sync events
    events.on('sync-add' as any, (e: CustomEvent) => {
      this.syncQueue?.add(e.detail)
    })

    events.on('sync-force' as any, () => {
      if (this.syncQueue && this.syncQueue.getPendingCount() > 0) {
        this.syncQueue.process()
      }
    })

    events.on(EVENT.SYNC_STATUS, (e: CustomEvent) => {
      ui.updateSyncStatus(e.detail)
    })

    events.on(EVENT.OPERATION_SYNCED, (e: CustomEvent) => {
      console.log('Synced to server:', e.detail.type)
    })

    events.on(EVENT.SYNC_ERROR, (e: CustomEvent) => {
      const { error, maxRetriesReached, retryCount, maxRetries } = e.detail

      if (maxRetriesReached) {
        notifications.error(
          'Failed to sync note after multiple attempts. Please check your connection.',
          {
            title: 'Sync Failed',
            duration: 5000
          }
        )
      } else if (retryCount) {
        console.warn(`Sync retry ${retryCount}/${maxRetries}:`, error)
      }
    })

    // Session expired handling
    events.on('session-expired' as any, (e: CustomEvent) => {
      if (e.detail.isNoteRequest) {
        notifications.warning(
          'Session expired. Your notes are saved locally and will sync when you sign in again.',
          {
            title: 'Session Expired',
            duration: 10000
          }
        )
      }
    })

    // Sync failed due to session expired (persistent warning)
    events.on('sync-failed-session-expired' as any, (e: CustomEvent) => {
      console.warn('[MAIN] Note saved locally but NOT synced to server - session expired')

      // Show persistent warning
      notifications.error(
        'Your session has expired. Notes are saved locally but NOT syncing to Google Drive. Please refresh the page to sign in again.',
        {
          title: '⚠️ Session Expired - Not Syncing',
          duration: 0 // Persistent until clicked
        }
      )
    })

    // Sync failed due to other errors (network, server down, etc.)
    events.on('sync-failed' as any, (e: CustomEvent) => {
      console.warn('[MAIN] Note saved locally but sync failed:', e.detail.error)

      notifications.warning(
        'Note saved locally but could not sync to server. Will retry automatically.',
        {
          title: 'Sync Failed',
          duration: 5000
        }
      )
    })

    // Note events
    events.on(EVENT.NOTE_LOADED, (e: CustomEvent) => {
      markdownEditor.setContent(e.detail.content)
    })

    events.on(EVENT.NOTE_SAVED, () => {
      console.log('[Note] Saved')
    })

    // Context events
    events.on(EVENT.CONTEXT_CHANGED, async (e: CustomEvent) => {
      const context = e.detail.context

      // Force flush any pending editor changes and wait for save to complete
      console.log('[MAIN] Context changed, flushing editor...')
      await markdownEditor.forceFlush()
      console.log('[MAIN] Editor flushed, loading new context...')

      if (context) {
        let selectedDate = state.get('selectedDate')
        if (!selectedDate) {
          selectedDate = (state as any).get('today') as string
        }

        // Load notes list for context
        await notes.loadNotesList(context)

        calendar.render()
        if (selectedDate) {
          notes.ensureNoteInList(context, selectedDate)
          await notes.loadNote(context, selectedDate)
        }
      } else {
        markdownEditor.setContent('')
      }
    })

    // Date events
    events.on(EVENT.DATE_CHANGED, async (e: CustomEvent) => {
      const dateStr = e.detail.date
      const context = state.get('selectedContext')

      // Force flush pending changes and wait for save to complete
      console.log('[MAIN] Date changed, flushing editor...')
      await markdownEditor.forceFlush()
      console.log('[MAIN] Editor flushed, loading new date...')

      if (context) {
        const currentContext = state.get('selectedContext')
        const currentDate = state.get('selectedDate')

        if (currentContext !== context || currentDate !== dateStr) {
          console.log('[MAIN] Context/date changed during handler, skipping')
          return
        }

        await notes.loadNote(context, dateStr)
      }
    })

    // Auth events
    events.on('auth-success' as any, async () => {
      await this.showApp()
    })

    events.on('auth-logout' as any, () => {
      markdownEditor.setContent('')
    })

    // UI events
    events.on(EVENT.SHOW_ERROR, (e: CustomEvent) => {
      if (e.detail.message) {
        notifications.error(e.detail.message)
      }
    })

    events.on(EVENT.SHOW_SUCCESS, (e: CustomEvent) => {
      if (e.detail.message) {
        notifications.success(e.detail.message)
      }
    })
  }

  private async showApp(): Promise<void> {
    console.log('[MAIN] showApp called')

    // Hide landing loader
    const loader = document.getElementById('landing-loader')
    if (loader) loader.classList.remove('visible')

    // Show app section
    const appSection = document.getElementById('app-section')
    const authSection = document.getElementById('auth-section')
    if (appSection) appSection.classList.add('visible')
    if (authSection) authSection.classList.remove('visible')

    try {
      // Load contexts
      console.log('[MAIN] Loading contexts...')
      await contexts.loadContexts()

      // Sync server time
      this.syncServerTime()

      // Set today's date
      notes.setTodayDate()

      // Render calendar
      calendar.render()

      // Auto-select last used context
      const lastContext = contexts.restoreLastContext()
      console.log('[MAIN] Last context:', lastContext)

      if (lastContext) {
        // Load notes list
        await notes.loadNotesList(lastContext)

        // Get today's date
        const todayDate = (state as any).get('today') as string

        // Ensure today's note exists in the list
        notes.ensureNoteInList(lastContext, todayDate)

        // Load today's note (create if doesn't exist)
        await notes.loadNote(lastContext, todayDate)
      }

      console.log('[MAIN] App initialization complete')
    } catch (error) {
      console.error('[MAIN] Error initializing app:', error)
      notifications.error('Failed to initialize app. Please refresh the page.', {
        title: 'Initialization Error',
        duration: 0
      })
    }
  }

  private async syncServerTime(): Promise<void> {
    try {
      const settings = state.get('userSettings')
      const timezone = settings.timezone || 'UTC'
      const clientTime = Date.now()

      const data = await api.getServerTime(timezone)
      const serverTime = (data.offset || 0) * 1000
      const roundTripTime = Date.now() - clientTime
      const offset = serverTime - clientTime + roundTripTime / 2

      state.set('serverTimeOffset', offset)
    } catch (error) {
      console.error('Failed to sync server time:', error)
    }

    // Resync every minute
    setTimeout(() => this.syncServerTime(), 60000)
  }

}

// Initialize app when DOM is ready
const app = new Application()

// Expose for window.onload and inline scripts
window.__APP__ = app

// Expose modules for debugging (development only)
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  window.__DEBUG__ = {
    app,
    state,
    events,
    notes,
    contexts,
    calendar,
    auth,
    api,
    cache,
    markdownEditor,
    notifications,
    ui
  }
  console.log('Debug mode enabled. Access modules via window.__DEBUG__')
}

// Auto-initialize
;(async () => {
  // Wait for template to inject GoogleClientID
  await new Promise(resolve => setTimeout(resolve, 0))

  // Get client ID from template (will be replaced by Jet)
  const clientIdMeta = document.querySelector('meta[name="google-client-id"]')
  const googleClientId = clientIdMeta?.getAttribute('content') || window.__GOOGLE_CLIENT_ID__

  if (googleClientId) {
    await app.init(googleClientId)
  } else {
    console.error('Google Client ID not found')
  }
})()

export default app
