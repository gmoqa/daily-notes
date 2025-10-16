/**
 * Sync Queue Module
 * Handles background synchronization with retry logic
 */

import { events, EVENT } from './events.js';

export class SyncQueue {
    constructor(api) {
        this.api = api;
        this.queue = [];
        this.processing = false;
        this.retryDelay = 2000;
        this.maxRetryDelay = 30000;
        this.batchTimer = null;
        this.batchDelay = 15000; // 15 seconds
        this.failedOperations = new Map(); // Track failed operations with retry count
        this.maxRetries = 3;
    }

    add(operation) {
        // Check if we already have a pending operation for this note
        if (operation.type === 'save-note') {
            const existingIndex = this.queue.findIndex(
                op => op.type === 'save-note' &&
                    op.data.context === operation.data.context &&
                    op.data.date === operation.data.date
            );

            if (existingIndex !== -1) {
                // Update existing operation instead of adding new one
                this.queue[existingIndex] = { ...operation, id: Date.now() + Math.random() };
            } else {
                this.queue.push({ ...operation, id: Date.now() + Math.random() });
            }
        } else {
            this.queue.push({ ...operation, id: Date.now() + Math.random() });
        }

        this.updateUI();
        this.scheduleBatch();
    }

    scheduleBatch() {
        // Clear existing timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }

        // Schedule batch processing after delay
        this.batchTimer = setTimeout(() => {
            this.process();
        }, this.batchDelay);
    }

    updateUI() {
        const pending = this.queue.length;
        events.emit(EVENT.SYNC_STATUS, {
            pending,
            syncing: this.processing
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;
        this.batchTimer = null;
        this.updateUI();

        while (this.queue.length > 0) {
            const op = this.queue[0];
            const opKey = this.getOperationKey(op);

            try {
                await this.executeOperation(op);

                // Success - remove from queue and failed operations
                this.queue.shift();
                this.failedOperations.delete(opKey);

                events.emit(EVENT.OPERATION_SYNCED, op);
                console.log('[Sync] Successfully synced:', op.type, opKey);
                this.updateUI();

                // Reset retry delay on success
                this.retryDelay = 2000;

            } catch (error) {
                console.warn('[Sync] Failed to sync operation:', error);

                // Check if this is a session expired error
                if (error.message && error.message.includes('Session expired')) {
                    console.log('[Sync] Session expired, keeping operations in queue for later');
                    // Don't remove from queue, will retry after re-login
                    break;
                }

                // Track retry count
                const retryCount = (this.failedOperations.get(opKey) || 0) + 1;
                this.failedOperations.set(opKey, retryCount);

                if (retryCount >= this.maxRetries) {
                    // Max retries reached - remove from queue
                    console.error(`[Sync] Max retries (${this.maxRetries}) reached for operation:`, opKey);
                    this.queue.shift();
                    this.failedOperations.delete(opKey);

                    events.emit(EVENT.SYNC_ERROR, {
                        operation: op,
                        error,
                        maxRetriesReached: true
                    });
                } else {
                    // Retry with exponential backoff
                    console.log(`[Sync] Retry ${retryCount}/${this.maxRetries} for operation:`, opKey);
                    events.emit(EVENT.SYNC_ERROR, {
                        operation: op,
                        error,
                        retryCount,
                        maxRetries: this.maxRetries
                    });

                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    this.retryDelay = Math.min(this.retryDelay * 1.5, this.maxRetryDelay);
                }
            }
        }

        this.processing = false;
        this.retryDelay = 2000;
        this.updateUI();
    }

    getOperationKey(op) {
        if (op.type === 'save-note') {
            return `${op.type}-${op.data.context}-${op.data.date}`;
        }
        return `${op.type}-${op.id}`;
    }

    async executeOperation(op) {
        switch (op.type) {
            case 'save-note':
                return await this.api.saveNote(op.data);

            case 'create-context':
                return await this.api.createContext(op.data);

            default:
                throw new Error('Unknown operation type');
        }
    }

    getPendingCount() {
        return this.queue.length;
    }

    clear() {
        this.queue = [];
        this.failedOperations.clear();
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.updateUI();
    }

    // Get statistics for debugging
    getStats() {
        return {
            queueSize: this.queue.length,
            processing: this.processing,
            failedOperations: this.failedOperations.size,
            retryDelay: this.retryDelay
        };
    }
}
