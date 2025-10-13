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
        this.batchTimer = null;
        this.batchDelay = 15000; // 15 seconds
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

            try {
                await this.executeOperation(op);
                this.queue.shift();
                events.emit(EVENT.OPERATION_SYNCED, op);
                this.updateUI();
            } catch (error) {
                console.warn('Sync failed, retrying...', error);
                events.emit(EVENT.SYNC_ERROR, { operation: op, error });

                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                this.retryDelay = Math.min(this.retryDelay * 1.5, 30000);
            }
        }

        this.processing = false;
        this.retryDelay = 2000;
        this.updateUI();
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
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.updateUI();
    }
}
