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
import { markdownEditor } from './markdown-editor.js';

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

        // Initialize Markdown Editor
        markdownEditor.init('markdown-editor-container', (content) => {
            notes.handleNoteInput(content);
        });

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

        events.on(EVENT.SYNC_ERROR, (e) => {
            const { error, maxRetriesReached, retryCount, maxRetries } = e.detail;

            if (maxRetriesReached) {
                notifications.error('Failed to sync note after multiple attempts. Please check your connection.', {
                    title: 'Sync Failed',
                    duration: 5000
                });
            } else if (retryCount) {
                console.warn(`Sync retry ${retryCount}/${maxRetries}:`, error);
            }
        });

        events.on('session-expired', (e) => {
            if (e.detail.isNoteRequest) {
                notifications.warning('Session expired. Your notes are saved locally and will sync when you sign in again.', {
                    title: 'Session Expired',
                    duration: 10000,
                    dismissible: true
                });
            }
        });

        // Note events
        events.on(EVENT.NOTE_LOADED, (e) => {
            markdownEditor.setContent(e.detail.content);
        });

        events.on(EVENT.NOTE_SAVED, () => {
            ui.updateSaveIndicator('saved');
        });

        // Context events
        events.on(EVENT.CONTEXT_CHANGED, async (e) => {
            const context = e.detail;

            // Force flush any pending editor changes
            markdownEditor.forceFlush();

            // Wait a bit for the flush to be processed
            await new Promise(resolve => setTimeout(resolve, 100));

            // Flush pending saves before switching
            if (this.syncQueue.getPendingCount() > 0) {
                console.log('[MAIN] Flushing pending saves before context change...');
                await this.syncQueue.process();
            }

            if (context) {
                notes.setTodayDate();
                await notes.loadNotesList(context);
                calendar.render();
                const selectedDate = state.get('selectedDate');
                await notes.loadNote(context, selectedDate);
            } else {
                markdownEditor.setContent('');
            }
        });

        // Date events
        events.on(EVENT.DATE_CHANGED, async (e) => {
            const dateStr = e.detail;
            const context = state.get('selectedContext');

            // Force flush any pending editor changes
            markdownEditor.forceFlush();

            // Wait a bit for the flush to be processed
            await new Promise(resolve => setTimeout(resolve, 100));

            // Flush pending saves before switching dates
            if (this.syncQueue.getPendingCount() > 0) {
                console.log('[MAIN] Flushing pending saves before date change...');
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
            markdownEditor.setContent('');
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

            // Update editor state based on whether we have a context
            ui.updateEditorState();

            if (lastContext) {
                // Load notes list
                await notes.loadNotesList(lastContext);

                // Get today's date
                const todayDate = state.get('today');

                // Ensure today's note exists in the list
                notes.ensureNoteInList(lastContext, todayDate);

                // Load today's note (create if doesn't exist)
                await notes.loadNote(lastContext, todayDate);
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
            const saveBtn = document.getElementById('settings-save-btn');
            const saveIcon = document.getElementById('settings-save-icon');
            const saveSpinner = document.getElementById('settings-save-spinner');
            const saveText = document.getElementById('settings-save-text');
            const cancelBtn = document.getElementById('settings-cancel-btn');

            const weekStartSelect = document.getElementById('week-start-select');
            const timezoneSelect = document.getElementById('timezone-select');
            const dateFormatSelect = document.getElementById('date-format-select');
            const uniqueContextModeSwitch = document.getElementById('unique-context-mode-switch');
            const showBreadcrumbSwitch = document.getElementById('show-breadcrumb-switch');
            const showMarkdownEditorSwitch = document.getElementById('show-markdown-editor-switch');
            const hideNewContextButtonSwitch = document.getElementById('hide-new-context-button-switch');
            const currentSettings = state.get('userSettings');

            const weekStart = parseInt(weekStartSelect?.value || '0');
            const timezone = timezoneSelect?.value || 'UTC';
            const dateFormat = dateFormatSelect?.value || 'DD-MM-YY';
            const uniqueContextMode = uniqueContextModeSwitch?.checked || false;
            const showBreadcrumb = showBreadcrumbSwitch?.checked === true;
            const showMarkdownEditor = showMarkdownEditorSwitch?.checked === true;
            const hideNewContextButton = hideNewContextButtonSwitch?.checked === true;
            const theme = currentSettings.theme || 'dark'; // Keep current theme

            // Show loading state
            if (saveBtn) saveBtn.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            if (saveIcon) saveIcon.style.display = 'none';
            if (saveSpinner) saveSpinner.style.display = 'inline-block';
            if (saveText) saveText.textContent = 'Saving...';

            try {
                await api.updateSettings({ theme, weekStart, timezone, dateFormat, uniqueContextMode, showBreadcrumb, showMarkdownEditor, hideNewContextButton });

                state.set('userSettings', { theme, weekStart, timezone, dateFormat, uniqueContextMode, showBreadcrumb, showMarkdownEditor, hideNewContextButton });
                calendar.render();

                // Show success state briefly
                if (saveText) saveText.textContent = 'Saved!';
                if (saveSpinner) saveSpinner.style.display = 'none';
                if (saveIcon) {
                    saveIcon.style.display = 'inline-flex';
                    saveIcon.querySelector('.material-symbols-outlined').textContent = 'check_circle';
                }

                // Wait a bit before closing to show success
                await new Promise(resolve => setTimeout(resolve, 500));

                ui.closeSettingsModal();

                // Re-render notes list to update date format
                ui.renderNotesList();

                // Update UI based on unique context mode
                ui.updateContextSelectorVisibility();

                // Update breadcrumb and markdown editor visibility
                ui.updateBreadcrumbVisibility();
                ui.updateMarkdownEditorVisibility();
                
                // Update new context button visibility
                ui.updateNewContextButtonVisibility();

                // If unique context mode is enabled, select first context
                if (uniqueContextMode) {
                    const contextsList = state.get('contexts');
                    if (contextsList && contextsList.length > 0) {
                        contexts.selectContext(contextsList[0].name);
                        notes.setTodayDate();
                        notes.loadNotesList(contextsList[0].name);
                    }
                }
            } catch (error) {
                console.error('Failed to save settings:', error);
                events.emit(EVENT.SHOW_ERROR, 'Failed to save settings');

                // Reset button state on error
                if (saveText) saveText.textContent = 'Save';
                if (saveSpinner) saveSpinner.style.display = 'none';
                if (saveIcon) {
                    saveIcon.style.display = 'inline-flex';
                    saveIcon.querySelector('.material-symbols-outlined').textContent = 'check';
                }
            } finally {
                // Re-enable buttons
                if (saveBtn) saveBtn.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
            }
        };

        window.closeOnboardingModal = () => ui.closeOnboardingModal();

        window.updateContextFromSettings = async (contextId) => {
            const nameInput = document.querySelector(`input[data-context-id="${contextId}"][data-field="name"]`);
            const colorInput = document.querySelector(`input[type="hidden"][data-context-id="${contextId}"][data-field="color"]`);
            
            if (!nameInput || !colorInput) return;
            
            const name = nameInput.value.trim();
            const color = colorInput.value;
            
            if (!name) {
                events.emit(EVENT.SHOW_ERROR, 'Context name cannot be empty');
                return;
            }
            
            const success = await contexts.updateContext(contextId, name, color);
            if (success) {
                // Refresh the contexts list in the modal
                ui.renderContextsEditList();
                // Refresh the contexts selectors
                ui.renderContextsSelect();
            }
        };

        window.toggleContextsAccordion = () => {
            const content = document.getElementById('contexts-accordion-content');
            const icon = document.getElementById('contexts-accordion-icon');
            
            if (!content || !icon) return;
            
            // Check if expanded by looking at the display property
            const isExpanded = content.style.display === 'block';
            
            const iconElement = icon.querySelector('.material-symbols-outlined');
            if (!iconElement) return;
            
            if (isExpanded) {
                // Collapse with smooth transition
                content.style.opacity = '0';
                setTimeout(() => {
                    content.style.display = 'none';
                    content.style.opacity = '1';
                }, 150);
                iconElement.textContent = 'expand_more';
            } else {
                // Expand with smooth transition
                content.style.display = 'block';
                content.style.opacity = '0';
                setTimeout(() => {
                    content.style.opacity = '1';
                }, 10);
                iconElement.textContent = 'expand_less';
            }
        };

        // Enter key support for modals
        document.getElementById('context-name')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') window.createContext();
        });

        // Warn before closing if there are pending sync operations
        window.addEventListener('beforeunload', (e) => {
            const pendingCount = this.syncQueue.getPendingCount();
            if (pendingCount > 0) {
                const message = `You have ${pendingCount} note${pendingCount !== 1 ? 's' : ''} pending sync. Your changes are saved locally but haven't been synced to Drive yet.`;
                e.preventDefault();
                e.returnValue = message;
                return message;
            }
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
        cache,
        markdownEditor
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
