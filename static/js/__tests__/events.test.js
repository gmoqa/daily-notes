/**
 * EventBus Tests
 * Tests for the central event system
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Create EventBus class for testing
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

const EVENT = {
    NOTE_CACHED: 'note-cached',
    NOTE_LOADED: 'note-loaded',
    NOTE_SAVED: 'note-saved',
    NOTE_CHANGED: 'note-changed',
    SYNC_STATUS: 'sync-status',
    OPERATION_SYNCED: 'operation-synced',
    SYNC_ERROR: 'sync-error',
    CONTEXT_CHANGED: 'context-changed',
    CONTEXTS_LOADED: 'contexts-loaded',
    DATE_CHANGED: 'date-changed',
    SHOW_ERROR: 'show-error',
    SHOW_SUCCESS: 'show-success',
};

describe('EventBus', () => {
    let events;

    beforeEach(() => {
        events = new EventBus();
    });

    describe('Basic Event Operations', () => {
        test('should emit and receive event', () => {
            const listener = jest.fn();
            events.on(EVENT.CONTEXT_CHANGED, listener);

            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'Work' })
            );
        });

        test('should emit event with complex data', () => {
            const listener = jest.fn();
            events.on(EVENT.NOTE_SAVED, listener);

            const noteData = {
                context: 'Work',
                date: '2025-10-16',
                content: 'Test content'
            };

            events.emit(EVENT.NOTE_SAVED, noteData);

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({ detail: noteData })
            );
        });

        test('should handle multiple listeners for same event', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();
            const listener3 = jest.fn();

            events.on(EVENT.CONTEXT_CHANGED, listener1);
            events.on(EVENT.CONTEXT_CHANGED, listener2);
            events.on(EVENT.CONTEXT_CHANGED, listener3);

            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
            expect(listener3).toHaveBeenCalled();
        });

        test('should handle multiple different events', () => {
            const contextListener = jest.fn();
            const dateListener = jest.fn();
            const noteListener = jest.fn();

            events.on(EVENT.CONTEXT_CHANGED, contextListener);
            events.on(EVENT.DATE_CHANGED, dateListener);
            events.on(EVENT.NOTE_SAVED, noteListener);

            events.emit(EVENT.CONTEXT_CHANGED, 'Work');
            events.emit(EVENT.DATE_CHANGED, '2025-10-16');
            events.emit(EVENT.NOTE_SAVED, { content: 'Test' });

            expect(contextListener).toHaveBeenCalledTimes(1);
            expect(dateListener).toHaveBeenCalledTimes(1);
            expect(noteListener).toHaveBeenCalledTimes(1);
        });
    });

    describe('Unsubscribe', () => {
        test('should unsubscribe listener', () => {
            const listener = jest.fn();
            const unsubscribe = events.on(EVENT.CONTEXT_CHANGED, listener);

            events.emit(EVENT.CONTEXT_CHANGED, 'Work');
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            events.emit(EVENT.CONTEXT_CHANGED, 'Personal');
            expect(listener).toHaveBeenCalledTimes(1); // Not called again
        });

        test('should not affect other listeners when unsubscribing', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();

            const unsubscribe1 = events.on(EVENT.CONTEXT_CHANGED, listener1);
            events.on(EVENT.CONTEXT_CHANGED, listener2);

            unsubscribe1();
            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            expect(listener1).not.toHaveBeenCalled();
            expect(listener2).toHaveBeenCalledTimes(1);
        });
    });

    describe('Once Listener', () => {
        test('should call listener only once', () => {
            const listener = jest.fn();
            events.once(EVENT.CONTEXT_CHANGED, listener);

            events.emit(EVENT.CONTEXT_CHANGED, 'Work');
            events.emit(EVENT.CONTEXT_CHANGED, 'Personal');
            events.emit(EVENT.CONTEXT_CHANGED, 'Projects');

            expect(listener).toHaveBeenCalledTimes(1);
        });

        test('should be unsubscribable', () => {
            const listener = jest.fn();
            const unsubscribe = events.once(EVENT.CONTEXT_CHANGED, listener);

            unsubscribe();
            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('Real-world Event Flows', () => {
        test('should handle context change flow', () => {
            const contextChangedListener = jest.fn();
            const noteLoadedListener = jest.fn();

            events.on(EVENT.CONTEXT_CHANGED, contextChangedListener);
            events.on(EVENT.NOTE_LOADED, noteLoadedListener);

            // Simulate user changing context
            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            // Simulate note loading
            events.emit(EVENT.NOTE_LOADED, {
                context: 'Work',
                date: '2025-10-16',
                content: 'Work notes'
            });

            expect(contextChangedListener).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'Work' })
            );
            expect(noteLoadedListener).toHaveBeenCalled();
        });

        test('should handle sync flow', () => {
            const syncStatusListener = jest.fn();
            const operationSyncedListener = jest.fn();

            events.on(EVENT.SYNC_STATUS, syncStatusListener);
            events.on(EVENT.OPERATION_SYNCED, operationSyncedListener);

            // Start sync
            events.emit(EVENT.SYNC_STATUS, { pending: 5, syncing: true });

            // Complete operations
            events.emit(EVENT.OPERATION_SYNCED, { type: 'save-note' });
            events.emit(EVENT.OPERATION_SYNCED, { type: 'save-note' });

            // End sync
            events.emit(EVENT.SYNC_STATUS, { pending: 0, syncing: false });

            expect(syncStatusListener).toHaveBeenCalledTimes(2);
            expect(operationSyncedListener).toHaveBeenCalledTimes(2);
        });

        test('should handle error notifications', () => {
            const errorListener = jest.fn();
            const successListener = jest.fn();

            events.on(EVENT.SHOW_ERROR, errorListener);
            events.on(EVENT.SHOW_SUCCESS, successListener);

            events.emit(EVENT.SHOW_ERROR, 'Failed to save note');
            events.emit(EVENT.SHOW_SUCCESS, 'Note saved successfully');

            expect(errorListener).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'Failed to save note' })
            );
            expect(successListener).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'Note saved successfully' })
            );
        });
    });

    describe('Event Ordering', () => {
        test('should maintain event order', () => {
            const callOrder = [];

            events.on(EVENT.CONTEXT_CHANGED, () => callOrder.push('context-1'));
            events.on(EVENT.CONTEXT_CHANGED, () => callOrder.push('context-2'));
            events.on(EVENT.CONTEXT_CHANGED, () => callOrder.push('context-3'));

            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            expect(callOrder).toEqual(['context-1', 'context-2', 'context-3']);
        });

        test('should handle rapid events', () => {
            const listener = jest.fn();
            events.on(EVENT.NOTE_CHANGED, listener);

            // Simulate rapid typing
            for (let i = 0; i < 10; i++) {
                events.emit(EVENT.NOTE_CHANGED, `Content ${i}`);
            }

            expect(listener).toHaveBeenCalledTimes(10);
        });
    });

    describe('Memory Management', () => {
        test('should not leak memory after unsubscribe', () => {
            const listeners = [];

            // Create and unsubscribe 100 listeners
            for (let i = 0; i < 100; i++) {
                const unsubscribe = events.on(EVENT.CONTEXT_CHANGED, () => {});
                listeners.push(unsubscribe);
            }

            listeners.forEach(unsub => unsub());

            const testListener = jest.fn();
            events.on(EVENT.CONTEXT_CHANGED, testListener);
            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            // Only the last listener should be called
            expect(testListener).toHaveBeenCalledTimes(1);
        });
    });

    describe('Edge Cases', () => {
        test('should handle listener that emits events', () => {
            const listener1 = jest.fn(() => {
                events.emit(EVENT.NOTE_SAVED, { cascade: true });
            });
            const listener2 = jest.fn();

            events.on(EVENT.CONTEXT_CHANGED, listener1);
            events.on(EVENT.NOTE_SAVED, listener2);

            events.emit(EVENT.CONTEXT_CHANGED, 'Work');

            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
        });

        test('should handle listener that throws error', () => {
            const errorListener = () => {
                throw new Error('Test error');
            };
            const goodListener = jest.fn();

            events.on(EVENT.CONTEXT_CHANGED, errorListener);
            events.on(EVENT.CONTEXT_CHANGED, goodListener);

            // EventTarget catches errors by default
            expect(() => {
                events.emit(EVENT.CONTEXT_CHANGED, 'Work');
            }).not.toThrow();

            expect(goodListener).toHaveBeenCalled();
        });

        test('should handle null/undefined event data', () => {
            const listener = jest.fn();
            events.on(EVENT.CONTEXT_CHANGED, listener);

            events.emit(EVENT.CONTEXT_CHANGED, null);
            events.emit(EVENT.CONTEXT_CHANGED, undefined);

            expect(listener).toHaveBeenCalledTimes(2);
        });
    });
});
