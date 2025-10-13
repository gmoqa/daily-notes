/**
 * Main Application Entry Point
 * Initializes and coordinates all modules
 */

import { state } from './state.js';
import { cache } from './cache.js';
import { api } from './api.js';
import { SyncQueue } from './sync.js';
import { events, EVENT } from './events.js';
import { auth } from './auth.js';
import { contexts } from './contexts.js';
import { notes } from './notes.js';
import { calendar } from './calendar.js';
import { ui } from './ui.js';
import { notifications } from './notifications.js';
import { loading } from './loading.js';

class Application {
    constructor() {
        this.syncQueue = null;
        this.googleClientId = null;
    }

    async init(googleClientId) {
        this.googleClientId = googleClientId;

        // Initialize cache
        try {
            await cache.init();
            console.log('Cache initialized');
        } catch (err) {
            console.warn('IndexedDB not available', err);
        }

        // Initialize sync queue
        this.syncQueue = new SyncQueue(api);

        // Setup event handlers
        this.setupEventHandlers();

        // Initialize UI
        ui.init();

        // Check authentication
        const isAuthenticated = await auth.checkAuth();

        if (isAuthenticated) {
            await this.showApp();
        } else {
            ui.hideApp();
            document.getElementById('auth-section')?.classList.add('visible');
        }

        // Make body visible after determining which section to show
        document.body.classList.add('loaded');

        // Initialize Google OAuth client
        if (typeof google !== 'undefined') {
            auth.initGoogleClient(googleClientId);
        }
    }

    setupEventHandlers() {
        // Sync events
        events.on('sync-add', (e) => {
            this.syncQueue.add(e.detail);
        });

        events.on('sync-force', () => {
            if (this.syncQueue.getPendingCount() > 0) {
                this.syncQueue.process();
            }
        });

        events.on(EVENT.SYNC_STATUS, (e) => {
            ui.updateSyncStatus(e.detail);
        });

        events.on(EVENT.OPERATION_SYNCED, (e) => {
            console.log('Synced to Drive:', e.detail.type);
        });

        // Note events
        events.on(EVENT.NOTE_LOADED, (e) => {
            const editor = ui.elements.noteEditor;
            if (editor) {
                editor.value = e.detail.content;
                ui.autoExpandTextarea(editor);
            }
        });

        events.on(EVENT.NOTE_SAVED, () => {
            ui.updateSaveIndicator('saved');
        });

        // Context events
        events.on(EVENT.CONTEXT_CHANGED, async (e) => {
            const context = e.detail;

            // Flush pending saves before switching
            if (this.syncQueue.getPendingCount() > 0) {
                await this.syncQueue.process();
            }

            if (context) {
                notes.setTodayDate();
                await notes.loadNotesList(context);
                calendar.render();
                const selectedDate = state.get('selectedDate');
                await notes.loadNote(context, selectedDate);
            } else {
                const editor = ui.elements.noteEditor;
                if (editor) {
                    editor.value = '';
                }
            }
        });

        // Date events
        events.on(EVENT.DATE_CHANGED, async (e) => {
            const dateStr = e.detail;
            const context = state.get('selectedContext');

            // Flush pending saves before switching dates
            if (this.syncQueue.getPendingCount() > 0) {
                await this.syncQueue.process();
            }

            if (context) {
                await notes.loadNote(context, dateStr);
            }
        });

        // Auth events
        events.on('auth-success', async () => {
            await this.showApp();
        });

        events.on('auth-logout', () => {
            ui.hideApp();
            this.syncQueue.clear();
            const editor = ui.elements.noteEditor;
            if (editor) editor.value = '';
        });

        // UI events
        events.on(EVENT.SHOW_ERROR, (e) => {
            ui.showError(e.detail);
        });

        events.on(EVENT.SHOW_SUCCESS, (e) => {
            ui.showSuccess(e.detail);
        });
    }

    async showApp() {
        console.log('[MAIN] showApp called');

        // Show UI immediately
        console.log('[MAIN] Calling ui.showApp()');
        ui.showApp();

        // Initialize app state with better error handling
        try {
            console.log('[MAIN] Loading contexts...');
            await contexts.loadContexts();

            console.log('[MAIN] Syncing server time...');
            this.syncServerTime(); // Run in background

            console.log('[MAIN] Setting today date...');
            notes.setTodayDate();

            console.log('[MAIN] Rendering calendar...');
            calendar.render();

            // Auto-select last used context
            const lastContext = contexts.restoreLastContext();
            console.log('[MAIN] Last context:', lastContext);

            if (lastContext) {
                await notes.loadNotesList(lastContext);
                const selectedDate = state.get('selectedDate');
                await notes.loadNote(lastContext, selectedDate);
            }

            console.log('[MAIN] App initialization complete');
        } catch (error) {
            console.error('[MAIN] Error initializing app:', error);
            notifications.error('Failed to initialize app. Please refresh the page.', {
                title: 'Initialization Error',
                duration: 0,
                dismissible: true
            });
        }
    }

    async syncServerTime() {
        try {
            const settings = state.get('userSettings');
            const timezone = settings.timezone || 'UTC';
            const clientTime = Date.now();

            const data = await api.getServerTime(timezone);
            const serverTime = data.timestamp * 1000;
            const roundTripTime = Date.now() - clientTime;
            const offset = serverTime - clientTime + (roundTripTime / 2);

            state.set('serverTimeOffset', offset);
        } catch (error) {
            console.error('Failed to sync server time:', error);
        }

        // Resync every minute
        setTimeout(() => this.syncServerTime(), 60000);
    }

    // Global methods for onclick handlers in HTML
    setupGlobalMethods() {
        window.signInWithGoogle = () => auth.signIn();
        window.signOutUser = () => auth.signOut();

        window.showNewContextModal = () => ui.showContextModal();
        window.closeContextModal = () => ui.closeContextModal();

        window.createContext = async () => {
            const nameInput = document.getElementById('context-name');
            const colorInput = document.getElementById('context-color');

            const name = nameInput?.value.trim();
            const color = colorInput?.value;

            if (!name) return;

            await contexts.createContext(name, color);
            ui.closeContextModal();

            await notes.loadNotesList(name);
            const selectedDate = state.get('selectedDate');
            await notes.loadNote(name, selectedDate);
        };

        window.showSettingsModal = () => ui.showSettingsModal();
        window.closeSettingsModal = () => ui.closeSettingsModal();

        window.saveSettings = async () => {
            const weekStartSelect = document.getElementById('week-start-select');
            const timezoneSelect = document.getElementById('timezone-select');
            const currentSettings = state.get('userSettings');

            const weekStart = parseInt(weekStartSelect?.value || '0');
            const timezone = timezoneSelect?.value || 'UTC';
            const theme = currentSettings.theme || 'dark'; // Keep current theme

            try {
                await api.updateSettings({ theme, weekStart, timezone });

                state.set('userSettings', { theme, weekStart, timezone });
                calendar.render();
                ui.closeSettingsModal();
            } catch (error) {
                console.error('Failed to save settings:', error);
                events.emit(EVENT.SHOW_ERROR, 'Failed to save settings');
            }
        };

        window.closeOnboardingModal = () => ui.closeOnboardingModal();

        // Enter key support for modals
        document.getElementById('context-name')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') window.createContext();
        });
    }
}

// Initialize app when DOM is ready
const app = new Application();

// Expose for window.onload and inline scripts
window.__APP__ = app;

// Expose modules for debugging (development only)
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    window.__DEBUG__ = {
        app,
        state,
        notifications,
        loading,
        events,
        ui,
        notes,
        contexts,
        calendar,
        auth,
        api,
        cache
    };
    console.log('Debug mode enabled. Access modules via window.__DEBUG__');
}

// Auto-initialize
(async () => {
    // Wait for template to inject GoogleClientID
    await new Promise(resolve => setTimeout(resolve, 0));

    // Get client ID from template (will be replaced by Jet)
    const clientIdMeta = document.querySelector('meta[name="google-client-id"]');
    const googleClientId = clientIdMeta?.content || window.__GOOGLE_CLIENT_ID__;

    if (googleClientId) {
        await app.init(googleClientId);
        app.setupGlobalMethods();
    } else {
        console.error('Google Client ID not found');
    }
})();

export default app;
