/**
 * Test Data Factories
 * Simple functions to create test data
 */

/**
 * Create a test note
 */
export function createNote(overrides = {}) {
    return {
        id: `test-note-${Date.now()}`,
        context: 'Work',
        date: '2025-10-16',
        content: 'Test note content',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides
    };
}

/**
 * Create multiple test notes
 */
export function createNotes(count, overrides = {}) {
    return Array.from({ length: count }, (_, i) =>
        createNote({
            id: `test-note-${i}`,
            date: `2025-10-${String(16 + i).padStart(2, '0')}`,
            ...overrides
        })
    );
}

/**
 * Create a test context
 */
export function createContext(overrides = {}) {
    return {
        id: `test-context-${Date.now()}`,
        name: 'Work',
        color: 'primary',
        created_at: new Date().toISOString(),
        ...overrides
    };
}

/**
 * Create multiple test contexts
 */
export function createContexts(count, overrides = {}) {
    const names = ['Work', 'Personal', 'Projects', 'Ideas', 'Notes'];
    const colors = ['primary', 'info', 'success', 'warning', 'danger'];

    return Array.from({ length: count }, (_, i) =>
        createContext({
            id: `test-context-${i}`,
            name: names[i] || `Context ${i}`,
            color: colors[i % colors.length],
            ...overrides
        })
    );
}

/**
 * Create test user
 */
export function createUser(overrides = {}) {
    return {
        id: 'test-user-1',
        email: 'test@example.com',
        name: 'Test User',
        ...overrides
    };
}

/**
 * Create test user settings
 */
export function createUserSettings(overrides = {}) {
    return {
        theme: 'dark',
        weekStart: 0,
        timezone: 'UTC',
        dateFormat: 'DD-MM-YY',
        showBreadcrumb: false,
        showMarkdownEditor: false,
        hideNewContextButton: false,
        uniqueContextMode: false,
        ...overrides
    };
}

/**
 * Create test state
 */
export function createTestState(overrides = {}) {
    return {
        currentUser: null,
        userSettings: createUserSettings(),
        selectedContext: null,
        selectedDate: null,
        contexts: [],
        notes: [],
        notesWithDates: [],
        currentCalendarMonth: new Date().getMonth(),
        currentCalendarYear: new Date().getFullYear(),
        isLoggingOut: false,
        syncStatus: { pending: 0, syncing: false },
        serverTimeOffset: 0,
        ...overrides
    };
}
