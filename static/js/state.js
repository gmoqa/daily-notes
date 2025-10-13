/**
 * Mini State Manager
 * Simple reactive state management without a framework
 */

class StateManager {
    constructor() {
        this._state = {
            // User state
            currentUser: null,
            userSettings: { theme: 'dark', weekStart: 0, timezone: 'UTC', dateFormat: 'DD-MM-YY' },

            // Selection state
            selectedContext: null,
            selectedDate: null,

            // Data state
            contexts: [],
            notes: [],
            notesWithDates: [],

            // Calendar state
            currentCalendarMonth: new Date().getMonth(),
            currentCalendarYear: new Date().getFullYear(),

            // UI state
            isLoggingOut: false,
            syncStatus: { pending: 0, syncing: false },

            // Time
            serverTimeOffset: 0,
        };

        this._listeners = new Map();
        this._computed = new Map();
    }

    /**
     * Get state value
     */
    get(key) {
        if (this._computed.has(key)) {
            return this._computed.get(key)(this._state);
        }
        return this._state[key];
    }

    /**
     * Set state value and notify listeners
     */
    set(key, value) {
        const oldValue = this._state[key];
        if (oldValue === value) return;

        this._state[key] = value;
        this._notify(key, value, oldValue);
    }

    /**
     * Update multiple state values at once
     */
    update(changes) {
        Object.entries(changes).forEach(([key, value]) => {
            this.set(key, value);
        });
    }

    /**
     * Subscribe to state changes
     */
    subscribe(key, callback) {
        if (!this._listeners.has(key)) {
            this._listeners.set(key, new Set());
        }
        this._listeners.get(key).add(callback);

        // Return unsubscribe function
        return () => {
            const listeners = this._listeners.get(key);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }

    /**
     * Subscribe to multiple keys
     */
    subscribeMany(keys, callback) {
        const unsubscribers = keys.map(key => this.subscribe(key, callback));
        return () => unsubscribers.forEach(unsub => unsub());
    }

    /**
     * Define computed property
     */
    computed(key, fn) {
        this._computed.set(key, fn);
    }

    /**
     * Get entire state (for debugging)
     */
    getState() {
        return { ...this._state };
    }

    /**
     * Notify listeners of change
     */
    _notify(key, newValue, oldValue) {
        const listeners = this._listeners.get(key);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(newValue, oldValue);
                } catch (error) {
                    console.error(`Error in state listener for "${key}":`, error);
                }
            });
        }

        // Notify wildcard listeners (*)
        const wildcardListeners = this._listeners.get('*');
        if (wildcardListeners) {
            wildcardListeners.forEach(callback => {
                try {
                    callback(key, newValue, oldValue);
                } catch (error) {
                    console.error('Error in wildcard state listener:', error);
                }
            });
        }
    }
}

// Create singleton instance
export const state = new StateManager();

// Setup computed properties
state.computed('today', (s) => {
    const timezone = s.userSettings.timezone || 'UTC';
    const now = new Date(Date.now() + s.serverTimeOffset);

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;

    return `${year}-${month}-${day}`;
});

// Debug helper
if (typeof window !== 'undefined') {
    window.__STATE__ = state;
}
