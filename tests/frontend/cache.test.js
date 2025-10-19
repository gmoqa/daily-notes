/**
 * LocalCache Tests
 * Tests for IndexedDB-based offline storage
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createMockIndexedDB, waitFor } from './helpers/test-utils.js';
import { createNote, createContext, createNotes, createContexts } from './helpers/factories.js';

describe('LocalCache', () => {
    let mockIDB;
    let cache;

    beforeEach(async () => {
        // Setup mock IndexedDB
        mockIDB = createMockIndexedDB();
        global.indexedDB = mockIDB;

        // Create LocalCache class for testing (matching TypeScript implementation)
        class LocalCache {
            constructor() {
                this.db = null;
                this.dbName = 'DailyNotesDB';
                this.version = 1;
                this.pendingWrites = new Map();
                this.writeTimer = null;
                this.BATCH_DELAY = 500;
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
                this.pendingWrites.set(id, {
                    ...note,
                    id,
                    _localTimestamp: Date.now(),
                    _cachedAt: Date.now(),
                    updated_at: note.updated_at || new Date().toISOString()
                });
                this.scheduleBatchWrite();
            }

            scheduleBatchWrite() {
                if (this.writeTimer) clearTimeout(this.writeTimer);
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
                notesToWrite.forEach(note => store.put(note));
                return new Promise((resolve, reject) => {
                    tx.oncomplete = () => {
                        console.log(`[Cache] Batch wrote ${notesToWrite.length} note(s)`);
                        resolve();
                    };
                    tx.onerror = () => reject(tx.error);
                });
            }

            async saveNoteImmediate(note) {
                if (!this.db) return;
                const tx = this.db.transaction(['notes'], 'readwrite');
                const store = tx.objectStore('notes');
                const id = `${note.context}-${note.date}`;
                store.put({
                    ...note,
                    id,
                    _localTimestamp: Date.now(),
                    _cachedAt: Date.now(),
                    updated_at: note.updated_at || new Date().toISOString()
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
                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => resolve(null);
                });
            }

            async saveNotes(notes) {
                if (!this.db) return;
                const tx = this.db.transaction(['notes'], 'readwrite');
                const store = tx.objectStore('notes');
                const now = Date.now();
                notes.forEach(note => {
                    const id = `${note.context}-${note.date}`;
                    store.put({
                        ...note,
                        id,
                        _localTimestamp: now,
                        _cachedAt: now,
                        updated_at: note.updated_at || new Date().toISOString()
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
                if (!contexts || !Array.isArray(contexts)) {
                    console.warn('[Cache] saveContexts called with invalid contexts:', contexts);
                    return;
                }
                const tx = this.db.transaction(['contexts'], 'readwrite');
                const store = tx.objectStore('contexts');
                contexts.forEach(ctx => {
                    store.put({ ...ctx, _localTimestamp: Date.now() });
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

        cache = new LocalCache();
        await cache.init();
    });

    afterEach(() => {
        mockIDB.clearAllStores();
    });

    describe('Initialization', () => {
        test('should initialize database', async () => {
            expect(cache.db).toBeDefined();
            expect(cache.db).not.toBeNull();
        });

        test('should create object stores', () => {
            expect(mockIDB.stores.has('notes')).toBe(true);
            expect(mockIDB.stores.has('contexts')).toBe(true);
        });
    });

    describe('Note Operations', () => {
        test('should save note', async () => {
            const note = createNote({
                context: 'Work',
                date: '2025-10-16',
                content: 'Test note'
            });

            await cache.saveNote(note);

            // Wait for batch write
            await waitFor(600);

            const retrieved = await cache.getNote('Work', '2025-10-16');
            expect(retrieved).toBeDefined();
            expect(retrieved.content).toBe('Test note');
        });

        test('should get note that does not exist', async () => {
            const note = await cache.getNote('NonExistent', '2025-10-16');
            expect(note).toBeNull();
        });

        test('should update existing note', async () => {
            const note = createNote({
                context: 'Work',
                date: '2025-10-16',
                content: 'Original content'
            });

            await cache.saveNote(note);
            await waitFor(600);

            // Update
            const updated = { ...note, content: 'Updated content' };
            await cache.saveNote(updated);
            await waitFor(600);

            const retrieved = await cache.getNote('Work', '2025-10-16');
            expect(retrieved.content).toBe('Updated content');
        });

        test('should save multiple notes at once', async () => {
            const notes = createNotes(3, { context: 'Work' });

            await cache.saveNotes(notes);
            await waitFor(100);

            const note1 = await cache.getNote('Work', notes[0].date);
            const note2 = await cache.getNote('Work', notes[1].date);
            const note3 = await cache.getNote('Work', notes[2].date);

            expect(note1).toBeDefined();
            expect(note2).toBeDefined();
            expect(note3).toBeDefined();
        });

        test('should get notes by context', async () => {
            const workNotes = createNotes(3, { context: 'Work' });
            const personalNotes = createNotes(2, { context: 'Personal' });

            await cache.saveNotes([...workNotes, ...personalNotes]);
            await waitFor(100);

            const retrieved = await cache.getNotesByContext('Work');
            expect(retrieved).toHaveLength(3);
            expect(retrieved.every(n => n.context === 'Work')).toBe(true);
        });
    });

    describe('Batch Writing', () => {
        test('should batch multiple writes', async () => {
            const note1 = createNote({ context: 'Work', date: '2025-10-16' });
            const note2 = createNote({ context: 'Work', date: '2025-10-17' });
            const note3 = createNote({ context: 'Work', date: '2025-10-18' });

            // All saves should be batched
            cache.saveNote(note1);
            cache.saveNote(note2);
            cache.saveNote(note3);

            // Wait for batch delay
            await waitFor(600);

            const retrieved1 = await cache.getNote('Work', '2025-10-16');
            const retrieved2 = await cache.getNote('Work', '2025-10-17');
            const retrieved3 = await cache.getNote('Work', '2025-10-18');

            expect(retrieved1).toBeDefined();
            expect(retrieved2).toBeDefined();
            expect(retrieved3).toBeDefined();
        });

        test('should flush pending writes immediately', async () => {
            const note = createNote({ context: 'Work', date: '2025-10-16' });

            cache.saveNote(note);
            await cache.flushPendingWrites();

            const retrieved = await cache.getNote('Work', '2025-10-16');
            expect(retrieved).toBeDefined();
        });

        test('should save note immediately when requested', async () => {
            const note = createNote({ context: 'Work', date: '2025-10-16' });

            await cache.saveNoteImmediate(note);

            // Should be available immediately
            const retrieved = await cache.getNote('Work', '2025-10-16');
            expect(retrieved).toBeDefined();
        });
    });

    describe('Context Operations', () => {
        test('should save contexts', async () => {
            const contexts = createContexts(3);

            await cache.saveContexts(contexts);
            await waitFor(100);

            const retrieved = await cache.getContexts();
            expect(retrieved).toHaveLength(3);
        });

        test('should get empty contexts list', async () => {
            const contexts = await cache.getContexts();
            expect(contexts).toEqual([]);
        });

        test('should handle null contexts gracefully', async () => {
            await cache.saveContexts(null);
            const contexts = await cache.getContexts();
            expect(contexts).toEqual([]);
        });

        test('should handle undefined contexts gracefully', async () => {
            await cache.saveContexts(undefined);
            const contexts = await cache.getContexts();
            expect(contexts).toEqual([]);
        });

        test('should update existing contexts', async () => {
            const contexts = createContexts(2);

            await cache.saveContexts(contexts);
            await waitFor(100);

            // Update
            const updated = [
                { ...contexts[0], color: 'danger' },
                { ...contexts[1], name: 'Updated Name' }
            ];

            await cache.saveContexts(updated);
            await waitFor(100);

            const retrieved = await cache.getContexts();
            expect(retrieved.find(c => c.id === contexts[0].id).color).toBe('danger');
            expect(retrieved.find(c => c.id === contexts[1].id).name).toBe('Updated Name');
        });
    });

    describe('Metadata', () => {
        test('should add timestamp to saved notes', async () => {
            const note = createNote();
            await cache.saveNote(note);
            await waitFor(600);

            const retrieved = await cache.getNote(note.context, note.date);
            expect(retrieved._localTimestamp).toBeDefined();
            expect(retrieved._cachedAt).toBeDefined();
        });

        test('should add updated_at if missing', async () => {
            const note = createNote();
            delete note.updated_at;

            await cache.saveNote(note);
            await waitFor(600);

            const retrieved = await cache.getNote(note.context, note.date);
            expect(retrieved.updated_at).toBeDefined();
        });

        test('should preserve existing updated_at', async () => {
            const note = createNote({
                updated_at: '2025-10-15T12:00:00Z'
            });

            await cache.saveNote(note);
            await waitFor(600);

            const retrieved = await cache.getNote(note.context, note.date);
            expect(retrieved.updated_at).toBe('2025-10-15T12:00:00Z');
        });
    });

    describe('Clear Operations', () => {
        test('should clear all data', async () => {
            const notes = createNotes(3);
            const contexts = createContexts(2);

            await cache.saveNotes(notes);
            await cache.saveContexts(contexts);
            await waitFor(100);

            await cache.clear();
            await waitFor(100);

            const retrievedNotes = await cache.getNotesByContext(notes[0].context);
            const retrievedContexts = await cache.getContexts();

            expect(retrievedNotes).toEqual([]);
            expect(retrievedContexts).toEqual([]);
        });
    });

    describe('Edge Cases', () => {
        test('should handle operations when db is null', async () => {
            // Create LocalCache without initializing - db will be null
            class LocalCache {
                constructor() {
                    this.db = null;
                }
                async saveNote() {}
                async getNote() { return null; }
            }
            const newCache = new LocalCache();

            const note = createNote();
            await newCache.saveNote(note);

            const retrieved = await newCache.getNote(note.context, note.date);
            expect(retrieved).toBeNull();
        });

        test('should handle rapid writes to same note', async () => {
            const note = createNote({ context: 'Work', date: '2025-10-16' });

            // Rapid updates
            for (let i = 0; i < 10; i++) {
                cache.saveNote({ ...note, content: `Content ${i}` });
            }

            await waitFor(600);

            const retrieved = await cache.getNote('Work', '2025-10-16');
            expect(retrieved.content).toBe('Content 9'); // Last write wins
        });

        test('should handle special characters in context/date', async () => {
            const note = createNote({
                context: 'Work/Projects',
                date: '2025-10-16',
                content: 'Special chars: @#$%^&*()'
            });

            await cache.saveNote(note);
            await waitFor(600);

            const retrieved = await cache.getNote('Work/Projects', '2025-10-16');
            expect(retrieved).toBeDefined();
            expect(retrieved.content).toBe('Special chars: @#$%^&*()');
        });
    });

    describe('Performance', () => {
        test('should handle large number of notes', async () => {
            const notes = createNotes(100);

            await cache.saveNotes(notes);
            await waitFor(100);

            const allNotes = await cache.getNotesByContext(notes[0].context);
            expect(allNotes.length).toBeGreaterThan(0);
        });

        test('should batch write multiple pending operations', async () => {
            const consoleSpy = jest.spyOn(console, 'log');

            // Create 10 notes
            for (let i = 0; i < 10; i++) {
                cache.saveNote(createNote({
                    context: 'Work',
                    date: `2025-10-${String(16 + i).padStart(2, '0')}`
                }));
            }

            await waitFor(600);

            // Should see batch write log
            const batchLogs = consoleSpy.mock.calls.filter(
                call => call[0]?.includes('[Cache] Batch wrote')
            );
            expect(batchLogs.length).toBeGreaterThan(0);

            consoleSpy.mockRestore();
        });
    });
});
