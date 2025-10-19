/**
 * Shared UI Types
 */

export interface UIElements {
    // Sections
    authSection: HTMLElement | null;
    appSection: HTMLElement | null;

    // Context
    contextSelect: HTMLSelectElement | null;
    contextColorIndicator: HTMLElement | null;

    // Mobile context
    mobileContextSelect: HTMLSelectElement | null;
    mobileContextColorIndicator: HTMLElement | null;

    // Date
    datePicker: HTMLInputElement | null;

    // Breadcrumb
    breadcrumbContextName: HTMLElement | null;
    breadcrumbDateName: HTMLElement | null;

    // Editor
    markdownEditorContainer: HTMLElement | null;
    saveIndicator: HTMLElement | null;

    // Notes list
    notesList: HTMLElement | null;

    // User
    userEmail: HTMLElement | null;

    // Time
    currentTime: HTMLElement | null;
    currentDate: HTMLElement | null;

    // Modals
    contextModal: HTMLElement | null;
    settingsModal: HTMLElement | null;
    onboardingModal: HTMLElement | null;

    // Sync status
    syncStatus: HTMLElement | null;
    syncStatusText: HTMLElement | null;

    // Theme
    themeToggleMenu: HTMLElement | null;
    themeToggleSwitch: HTMLInputElement | null;

    // Settings
    weekStartSelect: HTMLSelectElement | null;
    timezoneSelect: HTMLSelectElement | null;

    // Mobile navigation
    mobileNotesToggle: HTMLElement | null;
    mobileCalendarToggle: HTMLElement | null;
    sidebar: HTMLElement | null;
    calendarPanel: HTMLElement | null;
    sidebarOverlay: HTMLElement | null;
    calendarOverlay: HTMLElement | null;
    sidebarClose: HTMLElement | null;
    calendarClose: HTMLElement | null;
}

export interface SyncStatusOptions {
    pending: number;
    syncing: boolean;
}

export interface NotificationOptions {
    title?: string;
    duration?: number;
}
