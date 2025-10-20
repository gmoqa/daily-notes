/**
 * UI Module
 * Handles all UI rendering and user interactions
 */

import { state } from '@/utils/state'
import { contexts } from '@/services/contexts'
import { calendar } from '@/components/Calendar'
import { notes } from '@/services/notes'
import { events } from '@/utils/events'
import { api } from '@/services/api'
import { notifications } from '@/components/Notifications'
import { markdownEditor } from '@/components/Editor'
import { auth } from '@/services/auth'
import { cacheElements } from './ui/elements'
import { normalizeToBulmaColor, getColorLabel, setupColorButtons, selectColorButton } from './ui/colors'
import type { UIElements, SyncStatusOptions, NotificationOptions } from './ui/types'

export class UIManager {
    elements: UIElements;
    lastKnownDate: string | null;
    INITIAL_RENDER_COUNT: number;
    renderedNotesCount: number;
    clockStarted: boolean;

    constructor() {
        this.elements = {} as UIElements;
        this.lastKnownDate = null;
        // Virtual scrolling optimization
        this.INITIAL_RENDER_COUNT = 50; // Only render first 50 notes initially
        this.renderedNotesCount = this.INITIAL_RENDER_COUNT;
        this.clockStarted = false;
    }

    init(): void {
        this.elements = cacheElements()
        this.setupEventListeners()
        this.setupStateSubscriptions()
        this.setupUserDropdown()
        this.setupMobileNavigation()
        // Clock will start after server time sync in showApp()
    }

    setupEventListeners(): void {
        // Editor fullscreen button
        const editorFullscreenBtn = document.getElementById('editor-fullscreen-btn');
        if (editorFullscreenBtn) {
            editorFullscreenBtn.addEventListener('click', () => {
                this.openFullscreenNote();
            });
        }

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

                    let formattedDateStr: string;
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
            const context = (e.target as HTMLSelectElement).value;
            console.log('[UI] Desktop context selector changed:', context);
            contexts.selectContext(context);
        });

        // Context selection (mobile)
        // Just update state - the CONTEXT_CHANGED event handler will do the rest
        this.elements.mobileContextSelect?.addEventListener('change', (e) => {
            const context = (e.target as HTMLSelectElement).value;
            console.log('[UI] Mobile context selector changed:', context);
            contexts.selectContext(context);
        });

        // Date picker
        this.elements.datePicker?.addEventListener('change', async (e) => {
            const dateStr = (e.target as HTMLInputElement).value;
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
            this.setTheme((e.target as HTMLInputElement).checked ? 'dark' : 'light');
        });

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts(): void {
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
                events.emit('sync-force' as any, undefined);
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

    setupUserDropdown(): void {
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
            auth.signOut();
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!userDropdown.contains(e.target as Node)) {
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

    setupStateSubscriptions(): void {
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
        state.subscribe('selectedContext', (_context) => {
            this.updateBreadcrumb();
            // Reset virtual scrolling when switching contexts
            this.renderedNotesCount = this.INITIAL_RENDER_COUNT;
        });

        // Update date picker when selected date changes
        state.subscribe('selectedDate', (newDate) => {
            if (this.elements.datePicker && newDate) {
                this.elements.datePicker.value = newDate as string;
                this.updateDatePickerDisplay(newDate as string);
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

    renderContextsSelect(): void {
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

    updateContextIndicator(): void {
        // Update desktop indicator
        if (this.elements.contextSelect && this.elements.contextColorIndicator) {
            const opt = this.elements.contextSelect.options[this.elements.contextSelect.selectedIndex] as HTMLOptionElement;

            if (opt?.dataset.color && opt.value !== '') {
                const normalizedColor = normalizeToBulmaColor(opt.dataset.color);
                this.elements.contextColorIndicator.style.background = `var(--bulma-${normalizedColor})`;
                this.elements.contextColorIndicator.style.opacity = '1';
            } else {
                this.elements.contextColorIndicator.style.background = 'var(--bulma-grey-light)';
                this.elements.contextColorIndicator.style.opacity = '0.3';
            }
        }

        // Update mobile indicator
        if (this.elements.mobileContextSelect && this.elements.mobileContextColorIndicator) {
            const opt = this.elements.mobileContextSelect.options[this.elements.mobileContextSelect.selectedIndex] as HTMLOptionElement;

            if (opt?.dataset.color && opt.value !== '') {
                const normalizedColor = normalizeToBulmaColor(opt.dataset.color);
                this.elements.mobileContextColorIndicator.style.background = `var(--bulma-${normalizedColor})`;
                this.elements.mobileContextColorIndicator.style.opacity = '1';
            } else {
                this.elements.mobileContextColorIndicator.style.background = 'var(--bulma-grey-light)';
                this.elements.mobileContextColorIndicator.style.opacity = '0.3';
            }
        }
    }

    renderNotesList(): void {
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

            let dateStr: string;
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
                const dateStr = (link as HTMLElement).dataset.date;
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

    updateEditorState(): void {
        // Editor state is now managed by the markdown editor module
        const context = state.get('selectedContext');
        const contextsList = state.get('contexts') || [];

        // Update editor state based on context
        if (context) {
            markdownEditor.setDisabled(false);
        } else {
            // First ensure Quill is loaded before setting placeholder
            markdownEditor.ensureQuillLoaded().then(() => {
                markdownEditor.setDisabled(true);
                markdownEditor.setContent('');

                // If there are no contexts at all, show a message to create the first one
                if (contextsList.length === 0) {
                    // Wait a bit to ensure setDisabled has applied
                    setTimeout(() => {
                        markdownEditor.setPlaceholderMessage('Click "New Context" to create your first context and start writing notes.');
                    }, 100);
                }
            });
        }

        // Show/hide delete button based on context
        this.updateEditorDeleteButton();
    }

    updateEditorDeleteButton(): void {
        const editorDeleteBtn = document.getElementById('editor-delete-note-btn');
        const editorFullscreenBtn = document.getElementById('editor-fullscreen-btn');

        const context = state.get('selectedContext');
        const selectedDate = state.get('selectedDate');

        // Show buttons only if we have both context and selected date
        if (context && selectedDate) {
            if (editorDeleteBtn) editorDeleteBtn.style.display = 'flex';
            if (editorFullscreenBtn) editorFullscreenBtn.style.display = 'flex';
        } else {
            if (editorDeleteBtn) editorDeleteBtn.style.display = 'none';
            if (editorFullscreenBtn) editorFullscreenBtn.style.display = 'none';
        }
    }

    updateSaveIndicator(status: string): void {
        if (!this.elements.saveIndicator) return;

        this.elements.saveIndicator.className = `save-indicator ${status}`;

        if (status === 'saved') {
            this.elements.saveIndicator.textContent = 'Saved locally ✓';
            setTimeout(() => {
                if (this.elements.saveIndicator) {
                    this.elements.saveIndicator.textContent = '';
                }
            }, 2000);
        } else {
            this.elements.saveIndicator.textContent = '';
        }
    }

    updateSyncStatus({ pending, syncing }: SyncStatusOptions): void {
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
                if (this.elements.syncStatus) {
                    this.elements.syncStatus.style.display = 'none';
                    this.elements.syncStatus.classList.remove('is-syncing', 'is-pending');
                }
            }, 1000);
        }
    }

    setTheme(theme: string): void {
        document.documentElement.setAttribute('data-theme', theme);
        if (this.elements.themeToggleSwitch) {
            this.elements.themeToggleSwitch.checked = theme === 'dark';
        }
        this.updateThemeIcon();
        localStorage.setItem('theme', theme);
    }

    updateThemeIcon(): void {
        const theme = document.documentElement.getAttribute('data-theme');
        const themeIcon = this.elements.themeToggleMenu?.querySelector('.material-symbols-outlined');
        if (themeIcon) {
            themeIcon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
        }
    }

    showApp(_skipAnimation: boolean = false): void {
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

        // Update editor state (to show proper placeholder message)
        this.updateEditorState();

        // Start clock (after server time sync is complete)
        this.startClock();

        // Check if user has no contexts (new user or deleted all contexts)
        // We use hasNoContexts from the backend response, NOT from local state
        // because local state might not be loaded yet
        const hasNoContexts = (state as any).get('hasNoContexts');

        console.log('[UI] showApp - hasNoContexts:', hasNoContexts);

        // Show onboarding modal when user has no contexts
        // This happens when:
        // - New user (never created a context)
        // - User deleted all their contexts
        if (hasNoContexts) {
            console.log('[UI] Showing onboarding modal');
            setTimeout(() => {
                this.elements.onboardingModal?.classList.add('is-active');
            }, 500);
        } else {
            console.log('[UI] NOT showing onboarding modal');
        }
    }

    hideApp(): void {
        if (!this.elements.authSection || !this.elements.appSection) return;

        // Simple: hide app, show auth
        this.elements.appSection.classList.remove('visible');
        this.elements.authSection.classList.add('visible');
    }

    showError(message: string | { title?: string; message?: string; duration?: number }, options: NotificationOptions = {}): void {
        // Handle different error types
        let title = 'Error';
        let duration = 7000;
        let msg = '';

        if (typeof message === 'object') {
            // Structured error
            title = message.title || 'Error';
            msg = message.message || 'An error occurred';
            duration = message.duration || 7000;
        } else {
            msg = message;
        }

        // Check if it's a network error
        if (msg.includes('network') || msg.includes('offline')) {
            title = 'Connection Error';
            duration = 10000; // Longer for network issues
        }

        notifications.error(msg, { title, duration, ...options });
    }

    showSuccess(message: string, options: NotificationOptions = {}): void {
        notifications.success(message, { duration: 3000, ...options });
    }

    showWarning(message: string, options: NotificationOptions = {}): void {
        notifications.warning(message, { duration: 5000, ...options });
    }

    showInfo(message: string, options: NotificationOptions = {}): void {
        notifications.info(message, { duration: 4000, ...options });
    }

    // Modal methods
    showContextModal(): void {
        this.elements.contextModal?.classList.add('is-active');
        const nameInput = document.getElementById('context-name') as HTMLInputElement | null;
        const colorInput = document.getElementById('context-color') as HTMLInputElement | null;
        if (nameInput) nameInput.value = '';
        if (colorInput) colorInput.value = 'primary';

        // Setup color buttons handlers
        setupColorButtons('context-color', 'context-color-buttons');

        // Reset to primary
        selectColorButton('primary', 'context-color-buttons', 'context-color');

        nameInput?.focus();
    }

    closeContextModal(): void {
        this.elements.contextModal?.classList.remove('is-active');
    }

    showSettingsModal(): void {
        const settings = state.get('userSettings');

        if (this.elements.weekStartSelect) {
            this.elements.weekStartSelect.value = String(settings.weekStart);
        }
        if (this.elements.timezoneSelect) {
            this.elements.timezoneSelect.value = settings.timezone;
        }
        const dateFormatSelect = document.getElementById('date-format-select') as HTMLSelectElement | null;
        if (dateFormatSelect) {
            dateFormatSelect.value = settings.dateFormat || 'DD-MM-YY';
        }
        const uniqueContextModeSwitch = document.getElementById('unique-context-mode-switch') as HTMLInputElement | null;
        if (uniqueContextModeSwitch) {
            uniqueContextModeSwitch.checked = settings.uniqueContextMode || false;
        }
        const showBreadcrumbSwitch = document.getElementById('show-breadcrumb-switch') as HTMLInputElement | null;
        if (showBreadcrumbSwitch) {
            showBreadcrumbSwitch.checked = settings.showBreadcrumb === true;
        }
        const showMarkdownEditorSwitch = document.getElementById('show-markdown-editor-switch') as HTMLInputElement | null;
        if (showMarkdownEditorSwitch) {
            showMarkdownEditorSwitch.checked = settings.showMarkdownEditor === true;
        }
        const hideNewContextButtonSwitch = document.getElementById('hide-new-context-button-switch') as HTMLInputElement | null;
        if (hideNewContextButtonSwitch) {
            hideNewContextButtonSwitch.checked = settings.hideNewContextButton === true;
        }

        // Reset accordion to collapsed state
        const accordionContent = document.getElementById('contexts-accordion-content') as HTMLElement | null;
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
        const saveBtn = document.getElementById('settings-save-btn') as HTMLButtonElement | null;
        const saveIcon = document.getElementById('settings-save-icon');
        const saveSpinner = document.getElementById('settings-save-spinner') as HTMLElement | null;
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

    closeSettingsModal(): void {
        // Reset accordion to collapsed state before closing
        const accordionContent = document.getElementById('contexts-accordion-content') as HTMLElement | null;
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

    closeOnboardingModal(): void {
        this.elements.onboardingModal?.classList.remove('is-active');
        // No need to store in localStorage anymore since we use backend isFirstLogin flag
    }

    showDeleteNoteModal(context: string, date: string, formattedDate: string): void {
        const modal = document.getElementById('delete-note-modal') as HTMLElement & { dataset: { context?: string; date?: string } } | null;
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

    closeDeleteNoteModal(): void {
        const modal = document.getElementById('delete-note-modal') as HTMLElement & { dataset: { context?: string; date?: string } } | null;
        if (modal) {
            modal.classList.remove('is-active');
            delete modal.dataset.context;
            delete modal.dataset.date;
        }
    }

    closeAllModals(): void {
        this.closeContextModal();
        this.closeSettingsModal();
        this.closeOnboardingModal();
        this.closeDeleteNoteModal();
    }

    // Clock
    startClock(): void {
        if (this.clockStarted) {
            console.log('[UI] Clock already started, skipping');
            return;
        }
        this.clockStarted = true;
        console.log('[UI] Starting clock with server time sync');
        this.updateCurrentDateTime();
        setInterval(() => this.updateCurrentDateTime(), 1000);
    }

    updateCurrentDateTime(): void {
        const settings = state.get('userSettings');
        const timezone = settings.timezone || 'UTC';
        const dateFormat = settings.dateFormat || 'DD-MM-YY';
        const serverTimeOffset = state.get('serverTimeOffset');
        const now = new Date(Date.now() + serverTimeOffset);

        // Determine locale based on user's date format preference
        // MM-DD-YY: Use en-US (American format)
        // DD-MM-YY: Use browser locale or fallback to en-GB (European format)
        let locale: string;
        if (dateFormat === 'MM-DD-YY') {
            locale = 'en-US';
        } else {
            // Try to use the browser's locale, fallback to 'en-GB' if not available
            locale = navigator.language || navigator.languages?.[0] || 'en-GB';
        }

        const timeOptions: Intl.DateTimeFormatOptions = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: timezone
        };

        const dateOptions: Intl.DateTimeFormatOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: timezone
        };

        const timeString = now.toLocaleTimeString(locale, timeOptions);
        const dateString = now.toLocaleDateString(locale, dateOptions);

        // Desktop date with full format (weekday + date)
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = timeString;
        }
        if (this.elements.currentDate) {
            this.elements.currentDate.textContent = dateString;
        }

        // Mobile date without weekday (shorter format)
        const mobileDateOptions: Intl.DateTimeFormatOptions = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: timezone
        };
        const mobileDateString = now.toLocaleDateString(locale, mobileDateOptions);

        if (this.elements.mobileCurrentTime) {
            this.elements.mobileCurrentTime.textContent = timeString;
        }
        if (this.elements.mobileCurrentDate) {
            this.elements.mobileCurrentDate.textContent = mobileDateString;
        }

        // Check if day changed and update calendar
        const currentDate = (state as any).get('today') as string;
        if (this.lastKnownDate && this.lastKnownDate !== currentDate) {
            calendar.render();
        }
        this.lastKnownDate = currentDate as string | null;
    }

    updateDatePickerDisplay(dateStr: string): void {
        const displayElement = document.getElementById('date-picker-display');
        if (!displayElement || !dateStr) return;

        const settings = state.get('userSettings');
        const dateFormat = settings.dateFormat || 'DD-MM-YY';

        const [year, month, day] = dateStr.split('-').map(Number);

        // Format date based on user preference
        const yy = String(year).substring(2); // Get last 2 digits of year
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');

        let formattedDate: string;
        if (dateFormat === 'MM-DD-YY') {
            formattedDate = `${mm}/${dd}/${yy}`;
        } else {
            formattedDate = `${dd}/${mm}/${yy}`;
        }

        displayElement.textContent = formattedDate;
    }

    updateContextSelectorVisibility(): void {
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

    updateBreadcrumbVisibility(): void {
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

    updateMarkdownEditorVisibility(): void {
        const settings = state.get('userSettings');
        const showMarkdownEditor = settings.showMarkdownEditor === true;

        // Get the Quill toolbar
        const toolbar = document.querySelector('.ql-toolbar') as HTMLElement | null;
        if (toolbar) {
            toolbar.style.display = showMarkdownEditor ? '' : 'none';
        }

        // The editor itself should remain enabled based on context selection,
        // regardless of toolbar visibility
        const context = state.get('selectedContext');
        // Editor should be enabled if we have a context, regardless of toolbar visibility
        markdownEditor.setDisabled(context ? false : true);
    }

    updateNewContextButtonVisibility(): void {
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

    renderContextsEditList(): void {
        const contextsList = state.get('contexts');
        const container = document.getElementById('contexts-edit-list');

        if (!container) return;

        if (contextsList.length === 0) {
            container.innerHTML = '<p class="has-text-centered has-text-grey-light py-5">No contexts yet. Create your first context to get started!</p>';
            return;
        }

        container.innerHTML = contextsList.map((ctx, _index) => {
            // Normalize old hex colors to Bulma colors
            const normalizedColor = normalizeToBulmaColor(ctx.color);

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
                            onclick="window.showDeleteContextModal('${ctx.id}', '${ctx.name.replace(/'/g, "\\'")}')"
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


    setupMobileNavigation(): void {
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
                if ((e.target as HTMLElement).tagName === 'A' && window.innerWidth <= 768) {
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

    toggleMobileSidebar(): void {
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

    closeMobileSidebar(): void {
        if (!this.elements.sidebar || !this.elements.sidebarOverlay) return;

        this.elements.sidebar.classList.remove('active');
        this.elements.sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    toggleMobileCalendar(): void {
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

    closeMobileCalendar(): void {
        if (!this.elements.calendarPanel || !this.elements.calendarOverlay) return;

        this.elements.calendarPanel.classList.remove('active');
        this.elements.calendarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    updateBreadcrumb(): void {
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

            let dateStr: string;
            if (dateFormat === 'MM-DD-YY') {
                dateStr = `${mm}-${dd}-${yy}`;
            } else {
                dateStr = `${dd}-${mm}-${yy}`;
            }

            // Format: "Monday, 24-10-25.md" or "Monday, 10-24-25.md" depending on dateFormat
            const formattedDate = `${dayName}, ${dateStr}.md`;
            this.elements.breadcrumbDateName.textContent = formattedDate;

            // Update mobile selected note date with .md extension (no day name)
            if (this.elements.mobileSelectedNoteDate) {
                this.elements.mobileSelectedNoteDate.textContent = `${dateStr}.md`;
            }
        }
    }

    openFullscreenNote(): void {
        const context = state.get('selectedContext');
        const selectedDate = state.get('selectedDate');

        if (!context || !selectedDate) return;

        // Format date for display
        const settings = state.get('userSettings');
        const timezone = settings.timezone || 'UTC';
        const dateFormat = settings.dateFormat || 'DD-MM-YY';

        const [year, month, day] = selectedDate.split('-').map(Number);
        const dateObj = new Date(year, month - 1, day);

        const dayName = dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            timeZone: timezone
        });

        const yy = String(year).substring(2);
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');

        let dateStr: string;
        if (dateFormat === 'MM-DD-YY') {
            dateStr = `${mm}-${dd}-${yy}`;
        } else {
            dateStr = `${dd}-${mm}-${yy}`;
        }

        const formattedDate = `${dayName}, ${dateStr}.md`;

        // Get modal elements
        const modal = document.getElementById('fullscreen-note-modal');
        const dateEl = document.getElementById('fullscreen-note-date');
        const editorEl = document.getElementById('fullscreen-note-editor');

        if (!modal || !dateEl || !editorEl) return;

        // Set date
        dateEl.textContent = formattedDate;

        // Get current note content using the markdown editor
        const content = markdownEditor.getContent();

        // Create a read-only Quill instance for fullscreen
        if ((window as any).Quill) {
            // Clear previous instance if exists
            editorEl.innerHTML = '';

            const fullscreenQuill = new (window as any).Quill(editorEl, {
                theme: 'snow',
                readOnly: true,
                modules: {
                    toolbar: false
                }
            });

            fullscreenQuill.root.innerHTML = content;

            // Style the editor
            fullscreenQuill.root.style.fontSize = '16px';
            fullscreenQuill.root.style.lineHeight = '1.6';
        } else {
            // Fallback if Quill not loaded
            editorEl.innerHTML = content;
        }

        // Show modal
        modal.classList.add('is-active');

        // Add escape key listener
        const escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.closeFullscreenNote();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    closeFullscreenNote(): void {
        const modal = document.getElementById('fullscreen-note-modal');
        if (modal) {
            modal.classList.remove('is-active');
        }
    }
}

export const ui = new UIManager();

// Expose globally for browser compatibility and HTML onclick handlers
if (typeof window !== 'undefined') {
    (window as any).ui = ui;

    // Context modal handlers
    (window as any).showNewContextModal = () => ui.showContextModal();
    (window as any).closeContextModal = () => ui.closeContextModal();

    (window as any).createContext = async () => {
        const nameInput = document.getElementById('context-name') as HTMLInputElement | null;
        const colorInput = document.getElementById('context-color') as HTMLInputElement | null;

        const name = nameInput?.value.trim();
        const color = colorInput?.value;

        if (!name) return;

        await contexts.createContext(name, color);
        ui.closeContextModal();

        await notes.loadNotesList(name);
        const selectedDate = state.get('selectedDate');
        if (selectedDate) {
            await notes.loadNote(name, selectedDate);
        }
    };

    // Settings modal handlers
    (window as any).showSettingsModal = () => ui.showSettingsModal();
    (window as any).closeSettingsModal = () => ui.closeSettingsModal();

    (window as any).saveSettings = async () => {
        const saveBtn = document.getElementById('settings-save-btn') as HTMLButtonElement | null;
        const saveIcon = document.getElementById('settings-save-icon');
        const saveSpinner = document.getElementById('settings-save-spinner');
        const saveText = document.getElementById('settings-save-text');
        const cancelBtn = document.getElementById('settings-cancel-btn') as HTMLButtonElement | null;

        const weekStartSelect = document.getElementById('week-start-select') as HTMLSelectElement | null;
        const timezoneSelect = document.getElementById('timezone-select') as HTMLSelectElement | null;
        const dateFormatSelect = document.getElementById('date-format-select') as HTMLSelectElement | null;
        const uniqueContextModeSwitch = document.getElementById('unique-context-mode-switch') as HTMLInputElement | null;
        const showBreadcrumbSwitch = document.getElementById('show-breadcrumb-switch') as HTMLInputElement | null;
        const showMarkdownEditorSwitch = document.getElementById('show-markdown-editor-switch') as HTMLInputElement | null;
        const hideNewContextButtonSwitch = document.getElementById('hide-new-context-button-switch') as HTMLInputElement | null;
        const currentSettings = state.get('userSettings');

        const weekStart = parseInt(weekStartSelect?.value || '0');
        const timezone = timezoneSelect?.value || 'UTC';
        const dateFormat = dateFormatSelect?.value || 'DD-MM-YY';
        const uniqueContextMode = uniqueContextModeSwitch?.checked || false;
        const showBreadcrumb = showBreadcrumbSwitch?.checked === true;
        const showMarkdownEditor = showMarkdownEditorSwitch?.checked === true;
        const hideNewContextButton = hideNewContextButtonSwitch?.checked === true;
        const theme = currentSettings.theme || 'dark';

        // Show loading state
        if (saveBtn) saveBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        if (saveIcon) (saveIcon as HTMLElement).style.display = 'none';
        if (saveSpinner) (saveSpinner as HTMLElement).style.display = 'inline-block';
        if (saveText) saveText.textContent = 'Saving...';

        try {
            await api.updateSettings({ theme, weekStart, timezone, dateFormat, uniqueContextMode, showBreadcrumb, showMarkdownEditor, hideNewContextButton });

            state.set('userSettings', { theme, weekStart, timezone, dateFormat, uniqueContextMode, showBreadcrumb, showMarkdownEditor, hideNewContextButton });
            calendar.render();

            // Show success state briefly
            if (saveText) saveText.textContent = 'Saved!';
            if (saveSpinner) (saveSpinner as HTMLElement).style.display = 'none';
            if (saveIcon) {
                (saveIcon as HTMLElement).style.display = 'inline-flex';
                const iconEl = saveIcon.querySelector('.material-symbols-outlined');
                if (iconEl) iconEl.textContent = 'check_circle';
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
            notifications.error('Failed to save settings');

            // Reset button state on error
            if (saveText) saveText.textContent = 'Save';
            if (saveSpinner) (saveSpinner as HTMLElement).style.display = 'none';
            if (saveIcon) {
                (saveIcon as HTMLElement).style.display = 'inline-flex';
                const iconEl = saveIcon.querySelector('.material-symbols-outlined');
                if (iconEl) iconEl.textContent = 'check';
            }
        } finally {
            // Re-enable buttons
            if (saveBtn) saveBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
        }
    };

    // Onboarding modal handlers
    (window as any).closeOnboardingModal = () => ui.closeOnboardingModal();

    // Delete note modal handlers
    (window as any).closeDeleteNoteModal = () => ui.closeDeleteNoteModal();

    (window as any).confirmDeleteNote = async () => {
        const modal = document.getElementById('delete-note-modal') as HTMLElement & { dataset: { context?: string; date?: string } } | null;
        if (!modal) return;

        const context = modal.dataset.context;
        const dateStr = modal.dataset.date;

        if (context && dateStr) {
            // Close modal first
            ui.closeDeleteNoteModal();

            // Delete note immediately (notes module will handle UI updates)
            await notes.deleteNote(context, dateStr);
        }
    };

    // Edit context modal handlers
    (window as any).showEditContextModal = (contextId: string) => {
        const contextsList = state.get('contexts');
        const context = contextsList.find(c => c.id === contextId);
        if (!context) return;

        const modal = document.getElementById('edit-context-modal') as HTMLElement & { dataset: { contextId?: string } } | null;
        const nameInput = document.getElementById('edit-context-name') as HTMLInputElement | null;
        const colorValue = document.getElementById('edit-context-color-value') as HTMLInputElement | null;
        const colorsContainer = document.getElementById('edit-context-colors');

        if (!modal || !nameInput || !colorValue || !colorsContainer) return;

        // Set values
        nameInput.value = context.name;
        const normalizedColor = normalizeToBulmaColor(context.color);
        colorValue.value = normalizedColor;

        // Render color buttons
        const colors = ['text', 'link', 'primary', 'info', 'success', 'warning', 'danger'];
        colorsContainer.innerHTML = colors.map(color => {
            const isActive = normalizedColor === color;
            const borderStyle = isActive ? 'border: 3px solid var(--bulma-text)' : 'border: 3px solid transparent';
            return `
                <button type="button" class="button color-btn ${isActive ? 'is-active' : ''}"
                        data-color="${color}"
                        onclick="window.selectEditContextColor('${color}')"
                        title="${getColorLabel(color)}"
                        style="width: 32px; height: 32px; padding: 3px; ${borderStyle}; border-radius: 6px;">
                    <span style="display: block; width: 100%; height: 100%; background: var(--bulma-${color}); border-radius: 4px;"></span>
                </button>
            `;
        }).join('');

        // Store context ID and show modal
        modal.dataset.contextId = contextId;
        modal.classList.add('is-active');
    };

    (window as any).selectEditContextColor = (color: string) => {
        const colorValue = document.getElementById('edit-context-color-value') as HTMLInputElement | null;
        if (!colorValue) return;

        colorValue.value = color;

        // Update button states
        const buttons = document.querySelectorAll('#edit-context-colors .color-btn');
        buttons.forEach(btn => {
            const btnColor = (btn as HTMLElement).dataset.color;
            if (btnColor === color) {
                btn.classList.add('is-active');
                (btn as HTMLElement).style.border = '3px solid var(--bulma-text)';
            } else {
                btn.classList.remove('is-active');
                (btn as HTMLElement).style.border = '3px solid transparent';
            }
        });
    };

    (window as any).closeEditContextModal = () => {
        const modal = document.getElementById('edit-context-modal') as HTMLElement & { dataset: { contextId?: string } } | null;
        if (modal) {
            modal.classList.remove('is-active');
            delete modal.dataset.contextId;
        }
    };

    (window as any).confirmEditContext = async () => {
        const modal = document.getElementById('edit-context-modal') as HTMLElement & { dataset: { contextId?: string } } | null;
        if (!modal) return;

        const contextId = modal.dataset.contextId;
        const nameInput = document.getElementById('edit-context-name') as HTMLInputElement | null;
        const colorValue = document.getElementById('edit-context-color-value') as HTMLInputElement | null;

        if (!contextId || !nameInput || !colorValue) return;

        const name = nameInput.value.trim();
        const color = colorValue.value;

        if (!name) {
            alert('Please enter a context name');
            return;
        }

        // Close modal
        (window as any).closeEditContextModal();

        // Update context
        await contexts.updateContext(contextId, name, color);

        // Refresh UI
        ui.renderContextsEditList();
        ui.renderContextsSelect();
    };

    // Delete context modal handlers
    (window as any).showDeleteContextModal = (contextId: string, contextName: string) => {
        const modal = document.getElementById('delete-context-modal') as HTMLElement & { dataset: { contextId?: string } } | null;
        const nameElement = document.getElementById('delete-context-name');

        if (modal && nameElement) {
            nameElement.textContent = contextName;
            modal.dataset.contextId = contextId;
            modal.classList.add('is-active');
        }
    };

    (window as any).closeDeleteContextModal = () => {
        const modal = document.getElementById('delete-context-modal') as HTMLElement & { dataset: { contextId?: string } } | null;
        if (modal) {
            modal.classList.remove('is-active');
            delete modal.dataset.contextId;
        }
    };

    (window as any).confirmDeleteContext = async () => {
        const modal = document.getElementById('delete-context-modal') as HTMLElement & { dataset: { contextId?: string } } | null;
        if (!modal) return;

        const contextId = modal.dataset.contextId;

        if (contextId) {
            // Close modal first
            (window as any).closeDeleteContextModal();

            // Delete context (will also delete all its notes)
            await contexts.deleteContext(contextId);

            // Refresh UI
            ui.renderContextsEditList();
            ui.renderContextsSelect();
        }
    };
}
