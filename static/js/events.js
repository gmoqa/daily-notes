/**
 * Event Bus
 * Central event system for app-wide communication
 */

class EventBus extends EventTarget {
    emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    on(eventName, callback) {
        this.addEventListener(eventName, callback);
        return () => this.removeEventListener(eventName, callback);
    }

    once(eventName, callback) {
        const handler = (event) => {
            callback(event);
            this.removeEventListener(eventName, handler);
        };
        this.addEventListener(eventName, handler);
        return () => this.removeEventListener(eventName, handler);
    }
}

export const events = new EventBus();

// Event names for easy reference
export const EVENT = {
    // Notes
    NOTE_CACHED: 'note-cached',
    NOTE_LOADED: 'note-loaded',
    NOTE_SAVED: 'note-saved',
    NOTE_CHANGED: 'note-changed',

    // Sync
    SYNC_STATUS: 'sync-status',
    OPERATION_SYNCED: 'operation-synced',
    SYNC_ERROR: 'sync-error',

    // Context
    CONTEXT_CHANGED: 'context-changed',
    CONTEXTS_LOADED: 'contexts-loaded',

    // Date
    DATE_CHANGED: 'date-changed',

    // UI
    SHOW_ERROR: 'show-error',
    SHOW_SUCCESS: 'show-success',
};
