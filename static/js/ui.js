/**
 * UI Module
 * Handles all UI rendering and user interactions
 */

import { state } from './state.js';
import { contexts } from './contexts.js';
import { calendar } from './calendar.js';
import { notes } from './notes.js';
import { events, EVENT } from './events.js';
import { api } from './api.js';
import { notifications } from './notifications.js';

class UIManager {
    constructor() {
        this.elements = {};
        this.lastKnownDate = null;
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.setupStateSubscriptions();
        this.setupUserDropdown();
        this.startClock();
    }

    cacheElements() {
        this.elements = {
            // Sections
            authSection: document.getElementById('auth-section'),
            appSection: document.getElementById('app-section'),

            // Context
            contextSelect: document.getElementById('context-select'),
            contextColorIndicator: document.getElementById('context-color-indicator'),

            // Date
            datePicker: document.getElementById('date-picker'),

            // Editor
            noteEditor: document.getElementById('note-editor'),
            saveIndicator: document.getElementById('save-indicator'),

            // Notes list
            notesList: document.getElementById('notes-list'),

            // User
            userEmail: document.getElementById('user-email'),

            // Time
            currentTime: document.getElementById('current-time'),
            currentDate: document.getElementById('current-date'),

            // Modals
            contextModal: document.getElementById('context-modal'),
            settingsModal: document.getElementById('settings-modal'),
            onboardingModal: document.getElementById('onboarding-modal'),

            // Sync status
            syncStatus: document.getElementById('sync-status'),
            syncStatusText: document.getElementById('sync-status-text'),

            // Theme
            themeToggleMenu: document.getElementById('theme-toggle-menu'),
            themeToggleSwitch: document.getElementById('theme-toggle-switch'),

            // Settings
            weekStartSelect: document.getElementById('week-start-select'),
            timezoneSelect: document.getElementById('timezone-select'),
        };
    }

    setupEventListeners() {
        // Context selection
        this.elements.contextSelect?.addEventListener('change', (e) => {
            const context = e.target.value;
            contexts.selectContext(context);
            if (context) {
                notes.setTodayDate();
                notes.loadNotesList(context);
            }
        });

        // Date picker
        this.elements.datePicker?.addEventListener('change', (e) => {
            notes.selectDate(e.target.value);
        });

        // Note editor
        this.elements.noteEditor?.addEventListener('input', (e) => {
            notes.handleNoteInput(e.target.value);
        });

        // Calendar navigation
        document.getElementById('prev-month')?.addEventListener('click', () => {
            calendar.prevMonth();
        });

        document.getElementById('next-month')?.addEventListener('click', () => {
            calendar.nextMonth();
        });

        // Theme toggle
        this.elements.themeToggleMenu?.addEventListener('click', async (e) => {
            e.preventDefault();
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            this.setTheme(newTheme);

            const settings = state.get('userSettings');
            state.set('userSettings', { ...settings, theme: newTheme });

            try {
                await api.updateSettings({ ...settings, theme: newTheme });
            } catch (err) {
                console.error('Failed to save theme:', err);
            }
        });

        this.elements.themeToggleSwitch?.addEventListener('change', (e) => {
            this.setTheme(e.target.checked ? 'dark' : 'light');
        });

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modKey = isMac ? e.metaKey : e.ctrlKey;

            // Cmd/Ctrl+K: Focus context selector
            if (modKey && e.key === 'k') {
                e.preventDefault();
                this.elements.contextSelect?.focus();
                return;
            }

            // Cmd/Ctrl+S: Force sync
            if (modKey && e.key === 's') {
                e.preventDefault();
                events.emit('sync-force');
                return;
            }

            // Cmd/Ctrl+/: Focus editor
            if (modKey && e.key === '/') {
                e.preventDefault();
                if (!this.elements.noteEditor?.disabled) {
                    this.elements.noteEditor?.focus();
                }
                return;
            }

            // Escape: Close modals
            if (e.key === 'Escape') {
                this.closeAllModals();
                return;
            }
        });
    }

    setupUserDropdown() {
        const userDropdown = document.getElementById('user-dropdown');
        const userDropdownButton = document.getElementById('user-dropdown-button');
        const settingsMenuItem = document.getElementById('settings-menu-item');
        const signoutMenuItem = document.getElementById('signout-menu-item');

        if (!userDropdown || !userDropdownButton) return;

        // Toggle dropdown
        userDropdownButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            userDropdown.classList.toggle('is-active');
        });

        // Settings click
        settingsMenuItem?.addEventListener('click', (e) => {
            e.preventDefault();
            userDropdown.classList.remove('is-active');
            this.showSettingsModal();
        });

        // Sign out click
        signoutMenuItem?.addEventListener('click', (e) => {
            e.preventDefault();
            userDropdown.classList.remove('is-active');
            window.signOutUser();
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!userDropdown.contains(e.target)) {
                userDropdown.classList.remove('is-active');
            }
        });

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && userDropdown.classList.contains('is-active')) {
                userDropdown.classList.remove('is-active');
            }
        });
    }

    setupStateSubscriptions() {
        // Re-render UI when contexts change
        state.subscribe('contexts', () => {
            this.renderContextsSelect();
        });

        // Update calendar when month/year changes
        state.subscribeMany(['currentCalendarMonth', 'currentCalendarYear'], () => {
            calendar.render();
        });

        // Update UI when notes list changes
        state.subscribe('notes', () => {
            this.renderNotesList();
            calendar.render();
        });

        // Update date picker when selected date changes
        state.subscribe('selectedDate', (newDate) => {
            if (this.elements.datePicker) {
                this.elements.datePicker.value = newDate;
            }
            this.renderNotesList(); // Update active state
            calendar.render();
        });

        // Update context indicator when selected context changes
        state.subscribe('selectedContext', (selectedContext) => {
            // Update the select dropdown value
            if (this.elements.contextSelect && selectedContext) {
                this.elements.contextSelect.value = selectedContext;
            }
            this.updateContextIndicator();
            this.updateEditorState();
        });

        // Update user email when user changes
        state.subscribe('currentUser', (user) => {
            if (this.elements.userEmail && user) {
                this.elements.userEmail.textContent = user.email || '';
            }
        });

        // Update theme when settings change
        state.subscribe('userSettings', (settings) => {
            if (settings.theme) {
                this.setTheme(settings.theme);
            }
        });
    }

    renderContextsSelect() {
        const contextsList = state.get('contexts');
        if (!this.elements.contextSelect) return;

        const selectedContext = state.get('selectedContext');

        this.elements.contextSelect.innerHTML =
            '<option value="">Select context...</option>' +
            contextsList.map(c =>
                `<option value="${c.name}" data-color="${c.color || '#485fc7'}">${c.name}</option>`
            ).join('');

        if (selectedContext) {
            this.elements.contextSelect.value = selectedContext;
        }

        this.updateContextIndicator();
    }

    updateContextIndicator() {
        if (!this.elements.contextSelect || !this.elements.contextColorIndicator) return;

        const opt = this.elements.contextSelect.options[this.elements.contextSelect.selectedIndex];

        if (opt?.dataset.color && opt.value !== '') {
            this.elements.contextColorIndicator.style.background = opt.dataset.color;
            this.elements.contextColorIndicator.style.opacity = '1';
        } else {
            this.elements.contextColorIndicator.style.background = 'var(--bulma-grey-light)';
            this.elements.contextColorIndicator.style.opacity = '0.3';
        }
    }

    renderNotesList() {
        const notesList = state.get('notes');
        const selectedDate = state.get('selectedDate');

        if (!this.elements.notesList) return;

        if (notesList.length === 0) {
            this.elements.notesList.innerHTML = '<li class="has-text-centered py-6 has-text-grey-light">No notes yet</li>';
            return;
        }

        this.elements.notesList.innerHTML = notesList.map(note => {
            const [year, month, day] = note.date.split('-').map(Number);
            const dateObj = new Date(year, month - 1, day);
            const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            const isActive = note.date === selectedDate;

            return `
                <li>
                    <a
                        class="${isActive ? 'is-active' : ''}"
                        data-date="${note.date}"
                    >
                        ${formattedDate}
                    </a>
                </li>
            `;
        }).join('');

        // Add click handlers
        this.elements.notesList.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                const dateStr = link.dataset.date;
                if (dateStr) {
                    notes.selectDate(dateStr);
                }
            });
        });
    }

    updateEditorState() {
        if (!this.elements.noteEditor) return;

        const context = state.get('selectedContext');

        if (context) {
            this.elements.noteEditor.disabled = false;
            this.elements.noteEditor.placeholder = 'Daily Notes\n\nWhat did you work on today?';
        } else {
            this.elements.noteEditor.disabled = true;
            this.elements.noteEditor.placeholder = 'Select a context to start writing notes...';
            this.elements.noteEditor.value = '';
        }
    }

    updateSaveIndicator(status) {
        if (!this.elements.saveIndicator) return;

        this.elements.saveIndicator.className = `save-indicator ${status}`;

        if (status === 'saved') {
            this.elements.saveIndicator.textContent = 'Saved locally ✓';
            setTimeout(() => {
                this.elements.saveIndicator.textContent = '';
            }, 2000);
        } else {
            this.elements.saveIndicator.textContent = '';
        }
    }

    updateSyncStatus({ pending, syncing }) {
        if (!this.elements.syncStatus || !this.elements.syncStatusText) return;

        if (pending > 0) {
            this.elements.syncStatus.classList.add('visible');
            this.elements.syncStatus.classList.remove('synced', 'error');
            this.elements.syncStatusText.textContent = syncing
                ? `Syncing ${pending} change${pending > 1 ? 's' : ''}...`
                : `${pending} pending`;
        } else {
            this.elements.syncStatus.classList.add('synced');
            this.elements.syncStatus.classList.remove('error');
            this.elements.syncStatusText.textContent = 'All synced ✓';
            setTimeout(() => {
                this.elements.syncStatus.classList.remove('visible', 'synced');
            }, 2000);
        }
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (this.elements.themeToggleSwitch) {
            this.elements.themeToggleSwitch.checked = theme === 'dark';
        }
        this.updateThemeIcon();
        localStorage.setItem('theme', theme);
    }

    updateThemeIcon() {
        const theme = document.documentElement.getAttribute('data-theme');
        const themeIcon = this.elements.themeToggleMenu?.querySelector('.material-symbols-outlined');
        if (themeIcon) {
            themeIcon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
        }
    }

    showApp(skipAnimation = false) {
        console.log('[UI] showApp called');
        console.log('[UI] authSection:', this.elements.authSection);
        console.log('[UI] appSection:', this.elements.appSection);

        if (!this.elements.authSection || !this.elements.appSection) {
            console.error('[UI] Missing elements!');
            return;
        }

        // Hide loader if visible
        const loader = document.getElementById('landing-loader');
        if (loader) {
            console.log('[UI] Hiding loader');
            loader.classList.remove('visible');
        }

        // Simple: hide auth, show app
        console.log('[UI] Hiding auth section');
        this.elements.authSection.classList.remove('visible');

        console.log('[UI] Showing app section');
        this.elements.appSection.classList.add('visible');

        console.log('[UI] App section display:', window.getComputedStyle(this.elements.appSection).display);

        // Check if this is first login
        const hasSeenOnboarding = localStorage.getItem('onboarding_completed');
        if (!hasSeenOnboarding) {
            setTimeout(() => {
                this.elements.onboardingModal?.classList.add('is-active');
            }, 500);
        }
    }

    hideApp() {
        if (!this.elements.authSection || !this.elements.appSection) return;

        // Simple: hide app, show auth
        this.elements.appSection.classList.remove('visible');
        this.elements.authSection.classList.add('visible');
    }

    showError(message, options = {}) {
        // Handle different error types
        let title = 'Error';
        let duration = 7000;

        if (typeof message === 'object') {
            // Structured error
            title = message.title || 'Error';
            message = message.message || 'An error occurred';
            duration = message.duration || 7000;
        }

        // Check if it's a network error
        if (message.includes('network') || message.includes('offline')) {
            title = 'Connection Error';
            duration = 10000; // Longer for network issues
        }

        notifications.error(message, { title, duration, ...options });
    }

    showSuccess(message, options = {}) {
        notifications.success(message, { duration: 3000, ...options });
    }

    showWarning(message, options = {}) {
        notifications.warning(message, { duration: 5000, ...options });
    }

    showInfo(message, options = {}) {
        notifications.info(message, { duration: 4000, ...options });
    }

    // Modal methods
    showContextModal() {
        this.elements.contextModal?.classList.add('is-active');
        const nameInput = document.getElementById('context-name');
        const colorInput = document.getElementById('context-color');
        if (nameInput) nameInput.value = '';
        if (colorInput) colorInput.value = '#485fc7';
        nameInput?.focus();
    }

    closeContextModal() {
        this.elements.contextModal?.classList.remove('is-active');
    }

    showSettingsModal() {
        const settings = state.get('userSettings');

        if (this.elements.weekStartSelect) {
            this.elements.weekStartSelect.value = String(settings.weekStart);
        }
        if (this.elements.timezoneSelect) {
            this.elements.timezoneSelect.value = settings.timezone;
        }

        this.elements.settingsModal?.classList.add('is-active');
    }

    closeSettingsModal() {
        this.elements.settingsModal?.classList.remove('is-active');
    }

    closeOnboardingModal() {
        this.elements.onboardingModal?.classList.remove('is-active');
        localStorage.setItem('onboarding_completed', 'true');
    }

    closeAllModals() {
        this.closeContextModal();
        this.closeSettingsModal();
        this.closeOnboardingModal();
    }

    // Clock
    startClock() {
        this.updateCurrentDateTime();
        setInterval(() => this.updateCurrentDateTime(), 1000);
    }

    updateCurrentDateTime() {
        const settings = state.get('userSettings');
        const timezone = settings.timezone || 'UTC';
        const serverTimeOffset = state.get('serverTimeOffset');
        const now = new Date(Date.now() + serverTimeOffset);

        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: timezone
        };

        const dateOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: timezone
        };

        const timeString = now.toLocaleTimeString('en-US', timeOptions);
        const dateString = now.toLocaleDateString('en-US', dateOptions);

        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = timeString;
        }
        if (this.elements.currentDate) {
            this.elements.currentDate.textContent = dateString;
        }

        // Check if day changed and update calendar
        const currentDate = state.get('today');
        if (this.lastKnownDate && this.lastKnownDate !== currentDate) {
            calendar.render();
        }
        this.lastKnownDate = currentDate;
    }

    autoExpandTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(
            textarea.scrollHeight,
            parseInt(getComputedStyle(textarea).minHeight)
        ) + 'px';
    }
}

export const ui = new UIManager();
