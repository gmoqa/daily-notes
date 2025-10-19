/**
 * DOM Element Caching
 */

import type { UIElements } from './types'

export function cacheElements(): UIElements {
    return {
        // Sections
        authSection: document.getElementById('auth-section'),
        appSection: document.getElementById('app-section'),

        // Context
        contextSelect: document.getElementById('context-select') as HTMLSelectElement | null,
        contextColorIndicator: document.getElementById('context-color-indicator'),

        // Mobile context
        mobileContextSelect: document.getElementById('mobile-context-select') as HTMLSelectElement | null,
        mobileContextColorIndicator: document.getElementById('mobile-context-color-indicator'),

        // Date
        datePicker: document.getElementById('date-picker') as HTMLInputElement | null,

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
        themeToggleSwitch: document.getElementById('theme-toggle-switch') as HTMLInputElement | null,

        // Settings
        weekStartSelect: document.getElementById('week-start-select') as HTMLSelectElement | null,
        timezoneSelect: document.getElementById('timezone-select') as HTMLSelectElement | null,

        // Mobile navigation
        mobileNotesToggle: document.getElementById('mobile-notes-toggle'),
        mobileCalendarToggle: document.getElementById('mobile-calendar-toggle'),
        sidebar: document.querySelector('.sidebar') as HTMLElement | null,
        calendarPanel: document.querySelector('.calendar-panel') as HTMLElement | null,
        sidebarOverlay: document.getElementById('sidebar-overlay'),
        calendarOverlay: document.getElementById('calendar-overlay'),
        sidebarClose: document.getElementById('sidebar-close'),
        calendarClose: document.getElementById('calendar-close'),
    }
}
