/**
 * StateManager Tests
 * Tests for the reactive state management system
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { createTestState } from './helpers/factories.js';

// Create a fresh StateManager instance for testing
class StateManager {
    constructor() {
        this._state = {
            currentUser: null,
            userSettings: { theme: 'dark', weekStart: 0, timezone: 'UTC', dateFormat: 'DD-MM-YY', showBreadcrumb: false, showMarkdownEditor: false, hideNewContextButton: false },
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
        };
        this._listeners = new Map();
        this._computed = new Map();
    }

    get(key) {
        if (this._computed.has(key)) {
            return this._computed.get(key)(this._state);
        }
        return this._state[key];
    }

    set(key, value) {
        const oldValue = this._state[key];
        if (oldValue === value) return;
        this._state[key] = value;
        this._notify(key, value, oldValue);
    }

    update(changes) {
        Object.entries(changes).forEach(([key, value]) => {
            this.set(key, value);
        });
    }

    subscribe(key, callback) {
        if (!this._listeners.has(key)) {
            this._listeners.set(key, new Set());
        }
        this._listeners.get(key).add(callback);
        return () => {
            const listeners = this._listeners.get(key);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }

    subscribeMany(keys, callback) {
        const unsubscribers = keys.map(key => this.subscribe(key, callback));
        return () => unsubscribers.forEach(unsub => unsub());
    }

    computed(key, fn) {
        this._computed.set(key, fn);
    }

    getState() {
        return { ...this._state };
    }

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

describe('StateManager', () => {
    let state;

    beforeEach(() => {
        state = new StateManager();
    });

    describe('Basic Operations', () => {
        test('should get initial state value', () => {
            expect(state.get('selectedContext')).toBe(null);
            expect(state.get('contexts')).toEqual([]);
        });

        test('should set state value', () => {
            state.set('selectedContext', 'Work');
            expect(state.get('selectedContext')).toBe('Work');
        });

        test('should not notify if value is the same', () => {
            const listener = jest.fn();
            state.subscribe('selectedContext', listener);

            state.set('selectedContext', null);
            expect(listener).not.toHaveBeenCalled();
        });

        test('should get entire state', () => {
            const fullState = state.getState();
            expect(fullState).toHaveProperty('selectedContext');
            expect(fullState).toHaveProperty('contexts');
            expect(fullState).toHaveProperty('userSettings');
        });
    });

    describe('Update Multiple Values', () => {
        test('should update multiple values at once', () => {
            state.update({
                selectedContext: 'Work',
                selectedDate: '2025-10-16'
            });

            expect(state.get('selectedContext')).toBe('Work');
            expect(state.get('selectedDate')).toBe('2025-10-16');
        });

        test('should trigger listener for each updated value', () => {
            const contextListener = jest.fn();
            const dateListener = jest.fn();

            state.subscribe('selectedContext', contextListener);
            state.subscribe('selectedDate', dateListener);

            state.update({
                selectedContext: 'Work',
                selectedDate: '2025-10-16'
            });

            expect(contextListener).toHaveBeenCalledWith('Work', null);
            expect(dateListener).toHaveBeenCalledWith('2025-10-16', null);
        });
    });

    describe('Subscriptions', () => {
        test('should notify listener when value changes', () => {
            const listener = jest.fn();
            state.subscribe('selectedContext', listener);

            state.set('selectedContext', 'Work');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('Work', null);
        });

        test('should notify multiple listeners', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();

            state.subscribe('selectedContext', listener1);
            state.subscribe('selectedContext', listener2);

            state.set('selectedContext', 'Work');

            expect(listener1).toHaveBeenCalledWith('Work', null);
            expect(listener2).toHaveBeenCalledWith('Work', null);
        });

        test('should unsubscribe listener', () => {
            const listener = jest.fn();
            const unsubscribe = state.subscribe('selectedContext', listener);

            state.set('selectedContext', 'Work');
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            state.set('selectedContext', 'Personal');
            expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
        });

        test('should subscribe to multiple keys', () => {
            const listener = jest.fn();
            state.subscribeMany(['selectedContext', 'selectedDate'], listener);

            state.set('selectedContext', 'Work');
            state.set('selectedDate', '2025-10-16');

            expect(listener).toHaveBeenCalledTimes(2);
        });

        test('should unsubscribe from multiple keys', () => {
            const listener = jest.fn();
            const unsubscribe = state.subscribeMany(['selectedContext', 'selectedDate'], listener);

            state.set('selectedContext', 'Work');
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            state.set('selectedDate', '2025-10-16');
            expect(listener).toHaveBeenCalledTimes(1); // Not called again
        });

        test('should notify wildcard listeners', () => {
            const listener = jest.fn();
            state.subscribe('*', listener);

            state.set('selectedContext', 'Work');
            state.set('selectedDate', '2025-10-16');

            expect(listener).toHaveBeenCalledTimes(2);
            expect(listener).toHaveBeenCalledWith('selectedContext', 'Work', null);
            expect(listener).toHaveBeenCalledWith('selectedDate', '2025-10-16', null);
        });
    });

    describe('Computed Properties', () => {
        test('should compute derived value', () => {
            state.computed('fullName', (s) => {
                return s.currentUser ? `${s.currentUser.firstName} ${s.currentUser.lastName}` : null;
            });

            expect(state.get('fullName')).toBe(null);

            state.set('currentUser', { firstName: 'John', lastName: 'Doe' });
            expect(state.get('fullName')).toBe('John Doe');
        });

        test('should recompute when dependencies change', () => {
            state.computed('contextCount', (s) => s.contexts.length);

            expect(state.get('contextCount')).toBe(0);

            state.set('contexts', [{ name: 'Work' }, { name: 'Personal' }]);
            expect(state.get('contextCount')).toBe(2);
        });
    });

    describe('Error Handling', () => {
        test('should handle listener errors gracefully', () => {
            const errorListener = jest.fn(() => {
                throw new Error('Listener error');
            });
            const goodListener = jest.fn();

            state.subscribe('selectedContext', errorListener);
            state.subscribe('selectedContext', goodListener);

            // Should not throw
            expect(() => {
                state.set('selectedContext', 'Work');
            }).not.toThrow();

            // Good listener should still be called
            expect(goodListener).toHaveBeenCalled();
        });

        test('should handle wildcard listener errors', () => {
            const errorListener = jest.fn(() => {
                throw new Error('Wildcard error');
            });

            state.subscribe('*', errorListener);

            // Should not throw
            expect(() => {
                state.set('selectedContext', 'Work');
            }).not.toThrow();
        });
    });

    describe('Real-world Scenarios', () => {
        test('should handle context switching', () => {
            const listener = jest.fn();
            state.subscribe('selectedContext', listener);

            state.set('selectedContext', 'Work');
            state.set('selectedContext', 'Personal');
            state.set('selectedContext', 'Projects');

            expect(listener).toHaveBeenCalledTimes(3);
            expect(state.get('selectedContext')).toBe('Projects');
        });

        test('should handle calendar navigation', () => {
            state.update({
                currentCalendarMonth: 9,
                currentCalendarYear: 2025
            });

            expect(state.get('currentCalendarMonth')).toBe(9);
            expect(state.get('currentCalendarYear')).toBe(2025);
        });

        test('should handle sync status updates', () => {
            const listener = jest.fn();
            state.subscribe('syncStatus', listener);

            state.set('syncStatus', { pending: 5, syncing: true });
            state.set('syncStatus', { pending: 0, syncing: false });

            expect(listener).toHaveBeenCalledTimes(2);
        });
    });
});
