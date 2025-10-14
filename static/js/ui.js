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
        // Context selection (desktop)
        this.elements.contextSelect?.addEventListener('change', (e) => {
            const context = e.target.value;
            contexts.selectContext(context);
            if (context) {
                notes.setTodayDate();
                notes.loadNotesList(context);
            }
            // Sync with mobile select
            if (this.elements.mobileContextSelect) {
                this.elements.mobileContextSelect.value = context;
            }
        });

        // Context selection (mobile)
        this.elements.mobileContextSelect?.addEventListener('change', (e) => {
            const context = e.target.value;
            contexts.selectContext(context);
            if (context) {
                notes.setTodayDate();
                notes.loadNotesList(context);
            }
            // Sync with desktop select
            if (this.elements.contextSelect) {
                this.elements.contextSelect.value = context;
            }
        });

        // Date picker
        this.elements.datePicker?.addEventListener('change', (e) => {
            notes.selectDate(e.target.value);
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
        });
    }

    renderContextsSelect() {
        const contextsList = state.get('contexts');
        const selectedContext = state.get('selectedContext');

        const optionsHTML = '<option value="">Select context...</option>' +
            contextsList.map(c =>
                `<option value="${c.name}" data-color="${c.color || '#485fc7'}">${c.name}</option>`
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
                this.elements.contextColorIndicator.style.background = opt.dataset.color;
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
                this.elements.mobileContextColorIndicator.style.background = opt.dataset.color;
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

        this.elements.notesList.innerHTML = notesList.map(note => {
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
        // Editor state is now managed by the markdown editor module
        const context = state.get('selectedContext');

        // Import the markdown editor dynamically to avoid circular dependencies
        import('./markdown-editor.js').then(({ markdownEditor }) => {
            if (context) {
                markdownEditor.setDisabled(false);
            } else {
                markdownEditor.setDisabled(true);
                markdownEditor.setContent('');
            }
        });
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
        // Sync status indicator disabled
        // Users don't need to see sync feedback with SQLite local-first approach
        return;
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
            showBreadcrumbSwitch.checked = settings.showBreadcrumb !== false;
        }
        const showMarkdownEditorSwitch = document.getElementById('show-markdown-editor-switch');
        if (showMarkdownEditorSwitch) {
            showMarkdownEditorSwitch.checked = settings.showMarkdownEditor !== false;
        }

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
        const showBreadcrumb = settings.showBreadcrumb !== false;
        
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
        const showMarkdownEditor = settings.showMarkdownEditor !== false;

        // Get the Quill toolbar
        const toolbar = document.querySelector('.ql-toolbar');
        if (toolbar) {
            toolbar.style.display = showMarkdownEditor ? '' : 'none';
        }
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
