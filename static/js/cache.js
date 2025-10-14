/**
 * Local Cache Module
 * IndexedDB-based offline storage for notes and contexts
 */

export class LocalCache {
    constructor() {
        this.db = null;
        this.dbName = 'DailyNotesDB';
        this.version = 1;
        // Batch write optimization
        this.pendingWrites = new Map();
        this.writeTimer = null;
        this.BATCH_DELAY = 500; // ms
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                if (!db.objectStoreNames.contains('notes')) {
                    db.createObjectStore('notes', { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains('contexts')) {
                    db.createObjectStore('contexts', { keyPath: 'id' });
                }
            };
        });
    }

    async saveNote(note) {
        if (!this.db) return;

        const id = `${note.context}-${note.date}`;
        
        // Add to pending writes (batching)
        this.pendingWrites.set(id, {
            ...note,
            id,
            _localTimestamp: Date.now()
        });

        // Schedule batch write
        this.scheduleBatchWrite();

        return Promise.resolve();
    }

    scheduleBatchWrite() {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
        }

        this.writeTimer = setTimeout(() => {
            this.flushPendingWrites();
        }, this.BATCH_DELAY);
    }

    async flushPendingWrites() {
        if (!this.db || this.pendingWrites.size === 0) return;

        const notesToWrite = Array.from(this.pendingWrites.values());
        this.pendingWrites.clear();

        const tx = this.db.transaction(['notes'], 'readwrite');
        const store = tx.objectStore('notes');

        notesToWrite.forEach(note => {
            store.put(note);
        });

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => {
                console.log(`[Cache] Batch wrote ${notesToWrite.length} note(s)`);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    // Force immediate write (for critical operations)
    async saveNoteImmediate(note) {
        if (!this.db) return;

        const tx = this.db.transaction(['notes'], 'readwrite');
        const store = tx.objectStore('notes');
        const id = `${note.context}-${note.date}`;

        store.put({
            ...note,
            id,
            _localTimestamp: Date.now()
        });

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getNote(context, date) {
        if (!this.db) return null;

        const tx = this.db.transaction(['notes'], 'readonly');
        const store = tx.objectStore('notes');
        const id = `${context}-${date}`;

        return new Promise((resolve) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    }

    async saveNotes(notes) {
        if (!this.db) return;

        const tx = this.db.transaction(['notes'], 'readwrite');
        const store = tx.objectStore('notes');

        notes.forEach(note => {
            const id = `${note.context}-${note.date}`;
            store.put({
                ...note,
                id,
                _localTimestamp: Date.now()
            });
        });

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getNotesByContext(context) {
        if (!this.db) return [];

        const tx = this.db.transaction(['notes'], 'readonly');
        const store = tx.objectStore('notes');

        return new Promise((resolve) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const allNotes = request.result || [];
                resolve(allNotes.filter(n => n.context === context));
            };
            request.onerror = () => resolve([]);
        });
    }

    async saveContexts(contexts) {
        if (!this.db) return;

        // Handle null/undefined contexts
        if (!contexts || !Array.isArray(contexts)) {
            console.warn('[Cache] saveContexts called with invalid contexts:', contexts);
            return;
        }

        const tx = this.db.transaction(['contexts'], 'readwrite');
        const store = tx.objectStore('contexts');

        contexts.forEach(ctx => {
            store.put({
                ...ctx,
                _localTimestamp: Date.now()
            });
        });

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getContexts() {
        if (!this.db) return [];

        const tx = this.db.transaction(['contexts'], 'readonly');
        const store = tx.objectStore('contexts');

        return new Promise((resolve) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });
    }

    async clear() {
        if (!this.db) return;

        const tx = this.db.transaction(['notes', 'contexts'], 'readwrite');

        tx.objectStore('notes').clear();
        tx.objectStore('contexts').clear();

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

// Create singleton instance
export const cache = new LocalCache();
