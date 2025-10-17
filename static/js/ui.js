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
        // Virtual scrolling optimization
        this.INITIAL_RENDER_COUNT = 50; // Only render first 50 notes initially
        this.renderedNotesCount = this.INITIAL_RENDER_COUNT;
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.setupStateSubscriptions();
        this.setupUserDropdown();
        this.setupMobileNavigation();
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

            // Mobile context
            mobileContextSelect: document.getElementById('mobile-context-select'),
            mobileContextColorIndicator: document.getElementById('mobile-context-color-indicator'),

            // Date
            datePicker: document.getElementById('date-picker'),

            // Breadcrumb
            breadcrumbContextName: document.getElementById('breadcrumb-context-name'),
            breadcrumbDateName: document.getElementById('breadcrumb-date-name'),

            // Editor
            markdownEditorContainer: document.getElementById('markdown-editor-container'),
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

            // Mobile navigation
            mobileNotesToggle: document.getElementById('mobile-notes-toggle'),
            mobileCalendarToggle: document.getElementById('mobile-calendar-toggle'),
            sidebar: document.querySelector('.sidebar'),
            calendarPanel: document.querySelector('.calendar-panel'),
            sidebarOverlay: document.getElementById('sidebar-overlay'),
            calendarOverlay: document.getElementById('calendar-overlay'),
            sidebarClose: document.getElementById('sidebar-close'),
            calendarClose: document.getElementById('calendar-close'),
        };
    }

    setupEventListeners() {
        // Editor delete button
        const editorDeleteBtn = document.getElementById('editor-delete-note-btn');
        if (editorDeleteBtn) {
            editorDeleteBtn.addEventListener('click', () => {
                const context = state.get('selectedContext');
                const dateStr = state.get('selectedDate');

                if (context && dateStr) {
                    // Get formatted date for display
                    const settings = state.get('userSettings');
                    const timezone = settings.timezone || 'UTC';
                    const dateFormat = settings.dateFormat || 'DD-MM-YY';

                    const [year, month, day] = dateStr.split('-').map(Number);
                    const dateObj = new Date(year, month - 1, day);

                    // Get the day name
                    const dayName = dateObj.toLocaleDateString('en-US', {
                        weekday: 'long',
                        timeZone: timezone
                    });

                    // Format date
                    const yy = String(year).substring(2);
                    const mm = String(month).padStart(2, '0');
                    const dd = String(day).padStart(2, '0');

                    let formattedDateStr;
                    if (dateFormat === 'MM-DD-YY') {
                        formattedDateStr = `${mm}-${dd}-${yy}`;
                    } else {
                        formattedDateStr = `${dd}-${mm}-${yy}`;
                    }

                    const formattedDate = `${dayName}, ${formattedDateStr}`;

                    // Show modal
                    this.showDeleteNoteModal(context, dateStr, formattedDate);
                }
            });
        }

        // Context selection (desktop)
        // Just update state - the CONTEXT_CHANGED event handler will do the rest
        this.elements.contextSelect?.addEventListener('change', (e) => {
            const context = e.target.value;
            console.log('[UI] Desktop context selector changed:', context);
            contexts.selectContext(context);
        });

        // Context selection (mobile)
        // Just update state - the CONTEXT_CHANGED event handler will do the rest
        this.elements.mobileContextSelect?.addEventListener('change', (e) => {
            const context = e.target.value;
            console.log('[UI] Mobile context selector changed:', context);
            contexts.selectContext(context);
        });

        // Date picker
        this.elements.datePicker?.addEventListener('change', async (e) => {
            const dateStr = e.target.value;
            // Check if this date is already selected
            const currentDate = state.get('selectedDate');
            if (currentDate === dateStr) {
                console.log('[UI] Date picker: date already selected, skipping:', dateStr);
                return;
            }
            await notes.selectDate(dateStr);
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

            // Cmd/Ctrl+/: Focus editor (handled by markdown editor)
            if (modKey && e.key === '/') {
                e.preventDefault();
                return;
            }

            // Escape: Close modals
            if (e.key === 'Escape') {
                // Check if delete modal is open (highest priority)
                const deleteModal = document.getElementById('delete-note-modal');
                if (deleteModal?.classList.contains('is-active')) {
                    this.closeDeleteNoteModal();
                    return;
                }

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

        // Update breadcrumb when context changes
        state.subscribe('selectedContext', (context) => {
            this.updateBreadcrumb();
            // Reset virtual scrolling when switching contexts
            this.renderedNotesCount = this.INITIAL_RENDER_COUNT;
        });

        // Update date picker when selected date changes
        state.subscribe('selectedDate', (newDate) => {
            if (this.elements.datePicker) {
                this.elements.datePicker.value = newDate;
                this.updateDatePickerDisplay(newDate);
            }
            this.renderNotesList(); // Update active state
            calendar.render();
            this.updateBreadcrumb();
            this.updateEditorDeleteButton(); // Update delete button visibility
        });

        // Update date picker display when date format changes
        state.subscribe('userSettings', () => {
            const selectedDate = state.get('selectedDate');
            if (selectedDate) {
                this.updateDatePickerDisplay(selectedDate);
            }
            this.updateBreadcrumb();
        });

        // Update context indicator when selected context changes
        state.subscribe('selectedContext', (selectedContext) => {
            // Update the select dropdown values (both desktop and mobile)
            if (this.elements.contextSelect && selectedContext) {
                this.elements.contextSelect.value = selectedContext;
            }
            if (this.elements.mobileContextSelect && selectedContext) {
                this.elements.mobileContextSelect.value = selectedContext;
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
            // Update context selector visibility based on uniqueContextMode
            this.updateContextSelectorVisibility();
            // Update breadcrumb visibility
            this.updateBreadcrumbVisibility();
            // Update markdown editor visibility
            this.updateMarkdownEditorVisibility();
            // Update new context button visibility
            this.updateNewContextButtonVisibility();
        });
    }

    renderContextsSelect() {
        const contextsList = state.get('contexts');
        const selectedContext = state.get('selectedContext');

        const optionsHTML = '<option value="">Select context...</option>' +
            contextsList.map(c =>
                `<option value="${c.name}" data-color="${c.color || 'primary'}">${c.name}</option>`
            ).join('');

        // Update desktop selector
        if (this.elements.contextSelect) {
            this.elements.contextSelect.innerHTML = optionsHTML;
            if (selectedContext) {
                this.elements.contextSelect.value = selectedContext;
            }
        }

        // Update mobile selector
        if (this.elements.mobileContextSelect) {
            this.elements.mobileContextSelect.innerHTML = optionsHTML;
            if (selectedContext) {
                this.elements.mobileContextSelect.value = selectedContext;
            }
        }

        this.updateContextIndicator();
    }

    updateContextIndicator() {
        // Update desktop indicator
        if (this.elements.contextSelect && this.elements.contextColorIndicator) {
            const opt = this.elements.contextSelect.options[this.elements.contextSelect.selectedIndex];

            if (opt?.dataset.color && opt.value !== '') {
                const normalizedColor = this.normalizeToBulmaColor(opt.dataset.color);
                this.elements.contextColorIndicator.style.background = `var(--bulma-${normalizedColor})`;
                this.elements.contextColorIndicator.style.opacity = '1';
            } else {
                this.elements.contextColorIndicator.style.background = 'var(--bulma-grey-light)';
                this.elements.contextColorIndicator.style.opacity = '0.3';
            }
        }

        // Update mobile indicator
        if (this.elements.mobileContextSelect && this.elements.mobileContextColorIndicator) {
            const opt = this.elements.mobileContextSelect.options[this.elements.mobileContextSelect.selectedIndex];

            if (opt?.dataset.color && opt.value !== '') {
                const normalizedColor = this.normalizeToBulmaColor(opt.dataset.color);
                this.elements.mobileContextColorIndicator.style.background = `var(--bulma-${normalizedColor})`;
                this.elements.mobileContextColorIndicator.style.opacity = '1';
            } else {
                this.elements.mobileContextColorIndicator.style.background = 'var(--bulma-grey-light)';
                this.elements.mobileContextColorIndicator.style.opacity = '0.3';
            }
        }
    }

    renderNotesList() {
        const notesList = state.get('notes');
        const selectedDate = state.get('selectedDate');
        const settings = state.get('userSettings');
        const timezone = settings.timezone || 'UTC';
        const dateFormat = settings.dateFormat || 'DD-MM-YY';

        if (!this.elements.notesList) return;

        if (notesList.length === 0) {
            this.elements.notesList.innerHTML = '<li class="has-text-centered py-6 has-text-grey-light">No notes yet</li>';
            return;
        }

        // Virtual scrolling: only render visible notes
        const notesToRender = notesList.slice(0, this.renderedNotesCount);
        const hasMore = notesList.length > this.renderedNotesCount;

        this.elements.notesList.innerHTML = notesToRender.map(note => {
            const [year, month, day] = note.date.split('-').map(Number);
            const dateObj = new Date(year, month - 1, day);

            // Get the day name in English
            const dayName = dateObj.toLocaleDateString('en-US', {
                weekday: 'long',
                timeZone: timezone
            });

            // Format date based on user preference
            const yy = String(year).substring(2); // Get last 2 digits of year
            const mm = String(month).padStart(2, '0');
            const dd = String(day).padStart(2, '0');

            let dateStr;
            if (dateFormat === 'MM-DD-YY') {
                dateStr = `${mm}-${dd}-${yy}`;
            } else {
                dateStr = `${dd}-${mm}-${yy}`;
            }

            // Format: "Monday, 24-10-25.md" or "Monday, 10-24-25.md" depending on dateFormat
            const formattedDate = `${dayName}, ${dateStr}.md`;

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

        // Add "Load More" button if there are more notes
        if (hasMore) {
            this.elements.notesList.innerHTML += `
                <li class="has-text-centered py-3">
                    <button class="button is-small is-ghost" id="load-more-notes" style="opacity: 0.7;">
                        <span class="icon">
                            <span class="material-symbols-outlined">expand_more</span>
                        </span>
                        <span>Load ${Math.min(50, notesList.length - this.renderedNotesCount)} more</span>
                    </button>
                </li>
            `;
        }

        // Add click handlers for notes
        this.elements.notesList.querySelectorAll('a[data-date]').forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault(); // Prevent default link behavior
                const dateStr = link.dataset.date;
                if (dateStr) {
                    // Check if this date is already selected
                    const currentDate = state.get('selectedDate');
                    if (currentDate === dateStr) {
                        console.log('[UI] Date already selected, skipping:', dateStr);
                        return;
                    }
                    await notes.selectDate(dateStr);
                }
            });
        });

        // Add click handler for "Load More" button
        const loadMoreBtn = document.getElementById('load-more-notes');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                this.renderedNotesCount += 50;
                this.renderNotesList();
            });
        }
    }

    updateEditorState() {
        // Editor state is now managed by the markdown editor module
        const context = state.get('selectedContext');
        const contexts = state.get('contexts') || [];

        // Import the markdown editor dynamically to avoid circular dependencies
        import('./markdown-editor.js').then(({ markdownEditor }) => {
            if (context) {
                markdownEditor.setDisabled(false);
            } else {
                markdownEditor.setDisabled(true);
                markdownEditor.setContent('');

                // If there are no contexts at all, show a message to create the first one
                if (contexts.length === 0) {
                    markdownEditor.setPlaceholderMessage('Click "+ New Context" to create your first context and start writing notes');
                }
            }
        });

        // Show/hide delete button based on context
        this.updateEditorDeleteButton();
    }

    updateEditorDeleteButton() {
        const editorDeleteBtn = document.getElementById('editor-delete-note-btn');
        if (!editorDeleteBtn) return;

        const context = state.get('selectedContext');
        const selectedDate = state.get('selectedDate');

        // Show button only if we have both context and selected date
        if (context && selectedDate) {
            editorDeleteBtn.style.display = 'flex';
        } else {
            editorDeleteBtn.style.display = 'none';
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

        // Show sync indicator when there are pending operations or actively syncing
        if (pending > 0 || syncing) {
            this.elements.syncStatus.style.display = 'flex';

            if (syncing) {
                this.elements.syncStatusText.textContent = `Syncing ${pending} note${pending !== 1 ? 's' : ''}...`;
                this.elements.syncStatus.classList.add('is-syncing');
                this.elements.syncStatus.classList.remove('is-pending');
            } else {
                this.elements.syncStatusText.textContent = `${pending} note${pending !== 1 ? 's' : ''} pending sync`;
                this.elements.syncStatus.classList.add('is-pending');
                this.elements.syncStatus.classList.remove('is-syncing');
            }
        } else {
            // Hide after successful sync with a brief delay
            setTimeout(() => {
                this.elements.syncStatus.style.display = 'none';
                this.elements.syncStatus.classList.remove('is-syncing', 'is-pending');
            }, 1000);
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

        // Update context selector visibility based on settings
        this.updateContextSelectorVisibility();

        // Update breadcrumb and markdown editor visibility
        this.updateBreadcrumbVisibility();
        this.updateMarkdownEditorVisibility();
        
        // Update new context button visibility
        this.updateNewContextButtonVisibility();

        // Check if this is first login based on backend response
        const isFirstLogin = state.get('isFirstLogin');
        const isDevelopment = window.__ENV__ === 'development';

        // Show onboarding only if it's the user's first login
        // (verified by Google Drive - no dailynotes.dev folder/config exists)
        // In production, ONLY show when isFirstLogin is true
        // In development, always show for testing purposes
        if (isDevelopment || isFirstLogin) {
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
        if (colorInput) colorInput.value = 'primary';
        
        // Setup color buttons handlers
        this.setupColorButtons();
        
        // Reset to primary
        this.selectColorButton('primary');
        
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
        const dateFormatSelect = document.getElementById('date-format-select');
        if (dateFormatSelect) {
            dateFormatSelect.value = settings.dateFormat || 'DD-MM-YY';
        }
        const uniqueContextModeSwitch = document.getElementById('unique-context-mode-switch');
        if (uniqueContextModeSwitch) {
            uniqueContextModeSwitch.checked = settings.uniqueContextMode || false;
        }
        const showBreadcrumbSwitch = document.getElementById('show-breadcrumb-switch');
        if (showBreadcrumbSwitch) {
            showBreadcrumbSwitch.checked = settings.showBreadcrumb === true;
        }
        const showMarkdownEditorSwitch = document.getElementById('show-markdown-editor-switch');
        if (showMarkdownEditorSwitch) {
            showMarkdownEditorSwitch.checked = settings.showMarkdownEditor === true;
        }
        const hideNewContextButtonSwitch = document.getElementById('hide-new-context-button-switch');
        if (hideNewContextButtonSwitch) {
            hideNewContextButtonSwitch.checked = settings.hideNewContextButton === true;
        }

        // Reset accordion to collapsed state
        const accordionContent = document.getElementById('contexts-accordion-content');
        const accordionIcon = document.getElementById('contexts-accordion-icon');
        if (accordionContent) {
            accordionContent.style.display = 'none';
            accordionContent.style.opacity = '1'; // Reset opacity
        }
        if (accordionIcon) {
            const iconElement = accordionIcon.querySelector('.material-symbols-outlined');
            if (iconElement) iconElement.textContent = 'expand_more';
        }

        // Render contexts list
        this.renderContextsEditList();

        // Reset save button state
        const saveBtn = document.getElementById('settings-save-btn');
        const saveIcon = document.getElementById('settings-save-icon');
        const saveSpinner = document.getElementById('settings-save-spinner');
        const saveText = document.getElementById('settings-save-text');

        if (saveBtn) saveBtn.disabled = false;
        if (saveIcon) {
            saveIcon.style.display = 'inline-flex';
            const iconElement = saveIcon.querySelector('.material-symbols-outlined');
            if (iconElement) iconElement.textContent = 'check';
        }
        if (saveSpinner) saveSpinner.style.display = 'none';
        if (saveText) saveText.textContent = 'Save';

        this.elements.settingsModal?.classList.add('is-active');
    }

    closeSettingsModal() {
        // Reset accordion to collapsed state before closing
        const accordionContent = document.getElementById('contexts-accordion-content');
        const accordionIcon = document.getElementById('contexts-accordion-icon');
        if (accordionContent) {
            accordionContent.style.display = 'none';
            accordionContent.style.opacity = '1'; // Reset opacity
        }
        if (accordionIcon) {
            const iconElement = accordionIcon.querySelector('.material-symbols-outlined');
            if (iconElement) iconElement.textContent = 'expand_more';
        }
        
        this.elements.settingsModal?.classList.remove('is-active');
    }

    closeOnboardingModal() {
        this.elements.onboardingModal?.classList.remove('is-active');
        // No need to store in localStorage anymore since we use backend isFirstLogin flag
    }

    showDeleteNoteModal(context, date, formattedDate) {
        const modal = document.getElementById('delete-note-modal');
        const message = document.getElementById('delete-note-message');

        if (modal && message) {
            // Store the note info for later use
            modal.dataset.context = context;
            modal.dataset.date = date;

            // Update message with formatted date
            message.textContent = `Are you sure you want to delete the note for ${formattedDate}?`;

            modal.classList.add('is-active');
        }
    }

    closeDeleteNoteModal() {
        const modal = document.getElementById('delete-note-modal');
        if (modal) {
            modal.classList.remove('is-active');
            delete modal.dataset.context;
            delete modal.dataset.date;
        }
    }

    closeAllModals() {
        this.closeContextModal();
        this.closeSettingsModal();
        this.closeOnboardingModal();
        this.closeDeleteNoteModal();
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

    updateDatePickerDisplay(dateStr) {
        const displayElement = document.getElementById('date-picker-display');
        if (!displayElement || !dateStr) return;

        const settings = state.get('userSettings');
        const dateFormat = settings.dateFormat || 'DD-MM-YY';

        const [year, month, day] = dateStr.split('-').map(Number);

        // Format date based on user preference
        const yy = String(year).substring(2); // Get last 2 digits of year
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');

        let formattedDate;
        if (dateFormat === 'MM-DD-YY') {
            formattedDate = `${mm}/${dd}/${yy}`;
        } else {
            formattedDate = `${dd}/${mm}/${yy}`;
        }

        displayElement.textContent = formattedDate;
    }

    updateContextSelectorVisibility() {
        const settings = state.get('userSettings');
        const uniqueContextMode = settings.uniqueContextMode || false;

        // Get context selector containers (both desktop and mobile)
        const desktopContextContainer = document.getElementById('desktop-context-selector');
        const mobileContextContainer = document.getElementById('mobile-context-selector');

        if (uniqueContextMode) {
            // Hide context selectors
            if (desktopContextContainer) {
                desktopContextContainer.style.display = 'none';
            }
            if (mobileContextContainer) {
                mobileContextContainer.style.display = 'none';
            }
        } else {
            // Show context selectors
            if (desktopContextContainer) {
                desktopContextContainer.style.display = '';
            }
            if (mobileContextContainer) {
                mobileContextContainer.style.display = '';
            }
        }
    }

    updateBreadcrumbVisibility() {
        const settings = state.get('userSettings');
        const showBreadcrumb = settings.showBreadcrumb === true;
        
        const breadcrumb = document.getElementById('drive-breadcrumb');
        const mainSection = document.querySelector('.main-section');
        
        // Show/hide breadcrumb
        if (breadcrumb) {
            breadcrumb.style.display = showBreadcrumb ? '' : 'none';
        }
        
        // Set data attribute that CSS will use to adjust spacing
        if (mainSection) {
            if (showBreadcrumb) {
                mainSection.removeAttribute('data-hide-breadcrumb');
            } else {
                mainSection.setAttribute('data-hide-breadcrumb', 'true');
            }
        }
    }

    updateMarkdownEditorVisibility() {
        const settings = state.get('userSettings');
        const showMarkdownEditor = settings.showMarkdownEditor === true;

        // Get the Quill toolbar
        const toolbar = document.querySelector('.ql-toolbar');
        if (toolbar) {
            toolbar.style.display = showMarkdownEditor ? '' : 'none';
        }

        // The editor itself should remain enabled based on context selection,
        // regardless of toolbar visibility
        import('./markdown-editor.js').then(({ markdownEditor }) => {
            if (markdownEditor.editor) {
                const context = state.get('selectedContext');
                // Editor should be enabled if we have a context, regardless of toolbar visibility
                markdownEditor.editor.enable(context ? true : false);
            }
        });
    }

    updateNewContextButtonVisibility() {
        const settings = state.get('userSettings');
        const hideNewContextButton = settings.hideNewContextButton === true;
        
        // Get new context buttons (both desktop and mobile)
        const desktopNewContextBtn = document.getElementById('desktop-new-context-btn');
        const mobileNewContextBtn = document.getElementById('mobile-new-context-btn');
        
        // Hide or show buttons
        if (desktopNewContextBtn) {
            desktopNewContextBtn.style.display = hideNewContextButton ? 'none' : '';
        }
        if (mobileNewContextBtn) {
            mobileNewContextBtn.style.display = hideNewContextButton ? 'none' : '';
        }
    }

    renderContextsEditList() {
        const contextsList = state.get('contexts');
        const container = document.getElementById('contexts-edit-list');

        if (!container) return;

        if (contextsList.length === 0) {
            container.innerHTML = '<p class="has-text-centered has-text-grey-light py-5">No contexts yet. Create your first context to get started!</p>';
            return;
        }

        container.innerHTML = contextsList.map((ctx, index) => {
            // Normalize old hex colors to Bulma colors
            const normalizedColor = this.normalizeToBulmaColor(ctx.color);

            return `
            <div class="is-flex is-align-items-center is-justify-content-space-between mb-3"
                 style="padding: 0.75rem 1rem; background: var(--bulma-scheme-main-bis); border-left: 3px solid var(--bulma-${normalizedColor}); border-radius: 6px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                <div class="is-flex is-align-items-center" style="gap: 0.75rem; flex: 1; min-width: 0;">
                    <span style="display: block; width: 12px; height: 12px; background: var(--bulma-${normalizedColor}); border-radius: 50%; flex-shrink: 0;"></span>
                    <span style="font-size: 0.9rem; font-weight: 500; color: var(--bulma-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ctx.name}</span>
                </div>
                <div class="is-flex is-align-items-center" style="gap: 0.35rem;">
                    <button class="button is-small context-action-btn context-edit-btn"
                            onclick="window.showEditContextModal('${ctx.id}')"
                            title="Edit context"
                            style="padding: 0.35rem; border: none; background: transparent; border-radius: 50%; width: 32px; height: 32px;">
                        <span class="icon is-small">
                            <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bulma-grey);">edit</span>
                        </span>
                    </button>
                    <button class="button is-small context-action-btn context-delete-btn"
                            onclick="window.showDeleteContextModal('${ctx.id}', '${ctx.name.replace(/'/g, "\\\'")}')"
                            title="Delete context"
                            style="padding: 0.35rem; border: none; background: transparent; border-radius: 50%; width: 32px; height: 32px;">
                        <span class="icon is-small">
                            <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bulma-grey);">delete</span>
                        </span>
                    </button>
                </div>
            </div>
        `;
        }).join('');
    }

    getColorLabel(color) {
        const labels = {
            'text': 'Text (Gray)',
            'link': 'Link (Blue)',
            'primary': 'Primary (Cyan)',
            'info': 'Info (Light Blue)',
            'success': 'Success (Green)',
            'warning': 'Warning (Yellow)',
            'danger': 'Danger (Red)'
        };
        return labels[color] || color;
    }

    setupColorButtons() {
        const hiddenInput = document.getElementById('context-color');
        
        // Get fresh button references each time
        const buttons = document.querySelectorAll('#context-color-buttons .color-btn');
        if (!buttons.length) return;
        
        buttons.forEach(button => {
            // Remove old listeners by cloning
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
        });
        
        // Get fresh references after cloning
        const colorButtons = document.querySelectorAll('#context-color-buttons .color-btn');
        
        colorButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const color = button.dataset.color;
                
                // Update hidden input
                if (hiddenInput) hiddenInput.value = color;
                
                // Update active state - get fresh references again
                const allButtons = document.querySelectorAll('#context-color-buttons .color-btn');
                allButtons.forEach(btn => {
                    btn.classList.remove('is-active');
                    btn.style.border = '3px solid transparent';
                    btn.style.borderRadius = '8px';
                });
                
                button.classList.add('is-active');
                button.style.border = '3px solid var(--bulma-text)';
                button.style.borderRadius = '8px';
            });
        });
    }

    selectColorButton(color) {
        const colorButtons = document.querySelectorAll('#context-color-buttons .color-btn');
        const hiddenInput = document.getElementById('context-color');
        
        if (hiddenInput) hiddenInput.value = color;
        
        colorButtons.forEach(btn => {
            btn.classList.remove('is-active');
            btn.style.border = '3px solid transparent';
            btn.style.borderRadius = '8px';
            
            if (btn.dataset.color === color) {
                btn.classList.add('is-active');
                btn.style.border = `3px solid var(--bulma-text)`;
                btn.style.borderRadius = '8px';
            }
        });
    }

    normalizeToBulmaColor(color) {
        // If it's already a Bulma color name, return it
        const bulmaColors = ['text', 'link', 'primary', 'info', 'success', 'warning', 'danger'];
        if (bulmaColors.includes(color)) {
            return color;
        }
        
        // Map old hex colors to closest Bulma color
        const hexToColor = {
            '#485fc7': 'primary',
            '#3e8ed0': 'info',
            '#48c78e': 'success',
            '#ffe08a': 'warning',
            '#f14668': 'danger'
        };
        
        return hexToColor[color] || 'primary';
    }

    setupMobileNavigation() {
        // Toggle sidebar (notes list)
        this.elements.mobileNotesToggle?.addEventListener('click', () => {
            this.toggleMobileSidebar();
        });

        // Toggle calendar
        this.elements.mobileCalendarToggle?.addEventListener('click', () => {
            this.toggleMobileCalendar();
        });

        // Close sidebar
        this.elements.sidebarClose?.addEventListener('click', () => {
            this.closeMobileSidebar();
        });

        // Close calendar
        this.elements.calendarClose?.addEventListener('click', () => {
            this.closeMobileCalendar();
        });

        // Close on overlay click
        this.elements.sidebarOverlay?.addEventListener('click', () => {
            this.closeMobileSidebar();
        });

        this.elements.calendarOverlay?.addEventListener('click', () => {
            this.closeMobileCalendar();
        });

        // Close mobile panels when selecting a note
        if (this.elements.notesList) {
            this.elements.notesList.addEventListener('click', (e) => {
                if (e.target.tagName === 'A' && window.innerWidth <= 768) {
                    this.closeMobileSidebar();
                }
            });
        }

        // Clean up mobile panel states on resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                // Remove mobile panel classes and reset styles when returning to desktop
                if (this.elements.sidebar) {
                    this.elements.sidebar.classList.remove('mobile-panel', 'active');
                    this.elements.sidebar.style.display = '';
                }
                if (this.elements.calendarPanel) {
                    this.elements.calendarPanel.classList.remove('mobile-panel', 'active');
                    this.elements.calendarPanel.style.display = '';
                }
                if (this.elements.sidebarOverlay) {
                    this.elements.sidebarOverlay.classList.remove('active');
                }
                if (this.elements.calendarOverlay) {
                    this.elements.calendarOverlay.classList.remove('active');
                }
                document.body.style.overflow = '';
            }
        });
    }

    toggleMobileSidebar() {
        if (!this.elements.sidebar || !this.elements.sidebarOverlay) return;

        // Only work on mobile screens
        if (window.innerWidth > 768) return;

        const isActive = this.elements.sidebar.classList.contains('mobile-panel');

        if (!isActive) {
            // Add mobile-panel class and show
            this.elements.sidebar.classList.add('mobile-panel');
            this.elements.sidebar.style.display = 'flex';
        }

        // Toggle active state
        this.elements.sidebar.classList.toggle('active');
        this.elements.sidebarOverlay.classList.toggle('active');

        // Prevent body scroll when panel is open
        if (this.elements.sidebar.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }

    closeMobileSidebar() {
        if (!this.elements.sidebar || !this.elements.sidebarOverlay) return;

        this.elements.sidebar.classList.remove('active');
        this.elements.sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    toggleMobileCalendar() {
        if (!this.elements.calendarPanel || !this.elements.calendarOverlay) return;

        // Only work on mobile screens
        if (window.innerWidth > 768) return;

        const isActive = this.elements.calendarPanel.classList.contains('mobile-panel');

        if (!isActive) {
            // Add mobile-panel class and show
            this.elements.calendarPanel.classList.add('mobile-panel');
            this.elements.calendarPanel.style.display = 'flex';
        }

        // Toggle active state
        this.elements.calendarPanel.classList.toggle('active');
        this.elements.calendarOverlay.classList.toggle('active');

        // Prevent body scroll when panel is open
        if (this.elements.calendarPanel.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }

    closeMobileCalendar() {
        if (!this.elements.calendarPanel || !this.elements.calendarOverlay) return;

        this.elements.calendarPanel.classList.remove('active');
        this.elements.calendarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    updateBreadcrumb() {
        const context = state.get('selectedContext');
        const selectedDate = state.get('selectedDate');
        const settings = state.get('userSettings');
        const timezone = settings.timezone || 'UTC';
        const dateFormat = settings.dateFormat || 'DD-MM-YY';

        if (this.elements.breadcrumbContextName && context) {
            this.elements.breadcrumbContextName.textContent = context;
        }

        if (this.elements.breadcrumbDateName && selectedDate) {
            // Format date the same way as notes list
            const [year, month, day] = selectedDate.split('-').map(Number);
            const dateObj = new Date(year, month - 1, day);

            // Get the day name in English
            const dayName = dateObj.toLocaleDateString('en-US', {
                weekday: 'long',
                timeZone: timezone
            });

            // Format date based on user preference
            const yy = String(year).substring(2); // Get last 2 digits of year
            const mm = String(month).padStart(2, '0');
            const dd = String(day).padStart(2, '0');

            let dateStr;
            if (dateFormat === 'MM-DD-YY') {
                dateStr = `${mm}-${dd}-${yy}`;
            } else {
                dateStr = `${dd}-${mm}-${yy}`;
            }

            // Format: "Monday, 24-10-25.md" or "Monday, 10-24-25.md" depending on dateFormat
            const formattedDate = `${dayName}, ${dateStr}.md`;
            this.elements.breadcrumbDateName.textContent = formattedDate;
        }
    }
}

export const ui = new UIManager();
