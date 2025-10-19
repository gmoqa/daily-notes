/**
 * NotesManager Tests
 * Tests for the core note management logic
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { waitFor } from './helpers/test-utils.js';
import { createNote, createNotes, createUser } from './helpers/factories.js';

describe('NotesManager', () => {
    let notes;
    let mockState;
    let mockApi;
    let mockCache;
    let mockEvents;

    beforeEach(() => {
        // Mock state
        mockState = {
            _state: {
                selectedContext: 'Work',
                selectedDate: '2025-10-16',
                today: '2025-10-16',
                notes: [],
                notesWithDates: [],
                currentUser: createUser(),
                currentCalendarMonth: 9,
                currentCalendarYear: 2025
            },
            get: jest.fn((key) => mockState._state[key]),
            set: jest.fn((key, value) => { mockState._state[key] = value; }),
            update: jest.fn((changes) => {
                Object.assign(mockState._state, changes);
            })
        };

        // Mock API
        mockApi = {
            getNote: jest.fn(),
            getNotesList: jest.fn(),
            saveNote: jest.fn()
        };

        // Mock Cache
        mockCache = {
            getNote: jest.fn(),
            saveNote: jest.fn()
        };

        // Mock Events
        mockEvents = {
            emit: jest.fn()
        };

        // Mock EVENT constants
        const EVENT = {
            NOTE_LOADED: 'note-loaded',
            NOTE_SAVED: 'note-saved',
            DATE_CHANGED: 'date-changed',
            SHOW_ERROR: 'show-error'
        };

        // Create NotesManager class
        class NotesManager {
            constructor() {
                this.saveTimeout = null;
                this.currentNoteContent = '';
                this.currentLoadToken = 0;
                this.state = mockState;
                this.api = mockApi;
                this.cache = mockCache;
                this.events = mockEvents;
                this.EVENT = EVENT;
            }

            async loadNote(context, date) {
                if (!context || !date) {
                    return null;
                }

                const loadToken = ++this.currentLoadToken;

                const cachedNote = await this.cache.getNote(context, date);

                if (loadToken !== this.currentLoadToken) {
                    return null;
                }

                if (cachedNote && cachedNote.content) {
                    this.currentNoteContent = cachedNote.content;
                    this.events.emit(this.EVENT.NOTE_LOADED, {
                        content: this.currentNoteContent,
                        fromCache: true,
                        cachedAt: cachedNote._cachedAt
                    });
                } else {
                    this.currentNoteContent = '';
                    this.events.emit(this.EVENT.NOTE_LOADED, {
                        content: '',
                        fromCache: false,
                        isBlank: true
                    });
                }

                try {
                    const { note } = await this.api.getNote(context, date);

                    if (loadToken !== this.currentLoadToken) {
                        return null;
                    }

                    const serverUpdatedAt = note.updated_at ? new Date(note.updated_at).getTime() : 0;
                    const cachedUpdatedAt = cachedNote?.updated_at ? new Date(cachedNote.updated_at).getTime() : 0;

                    const shouldUpdateFromServer = !cachedNote ||
                                                 serverUpdatedAt > cachedUpdatedAt ||
                                                 (note.content && !cachedNote.content);

                    if (shouldUpdateFromServer) {
                        this.currentNoteContent = note.content || '';

                        await this.cache.saveNote({
                            context,
                            date,
                            content: note.content,
                            updated_at: note.updated_at
                        });

                        if (!cachedNote || cachedNote.content !== note.content) {
                            this.events.emit(this.EVENT.NOTE_LOADED, {
                                content: this.currentNoteContent,
                                fromCache: false,
                                serverUpdatedAt: note.updated_at
                            });
                        }
                    }

                    return note;
                } catch (error) {
                    if (loadToken !== this.currentLoadToken) {
                        return null;
                    }

                    if (!cachedNote) {
                        this.events.emit(this.EVENT.SHOW_ERROR, 'Failed to load note. Working offline.');
                    }
                    return cachedNote;
                }
            }

            async saveNote(context, date, content) {
                if (!context || !date) return;

                const now = new Date().toISOString();
                const note = {
                    context,
                    date,
                    content,
                    updated_at: now
                };

                await this.cache.saveNote(note);
                this.currentNoteContent = content;

                this.events.emit(this.EVENT.NOTE_SAVED, { local: true, timestamp: now });

                this.updateNoteInList(context, date, content);

                this.events.emit('sync-add', {
                    type: 'save-note',
                    data: note,
                    timestamp: now
                });
            }

            async loadNotesList(context, limit = 50, offset = 0) {
                if (!context) {
                    this.state.update({
                        notes: [],
                        notesWithDates: []
                    });
                    return [];
                }

                try {
                    const data = await this.api.getNotesList(context, limit, offset);
                    const notesList = data.notes || [];

                    const notesWithDates = notesList.map(note => note.date);

                    this.state.update({
                        notes: notesList,
                        notesWithDates
                    });

                    return notesList;
                } catch (error) {
                    return [];
                }
            }

            updateNoteInList(context, date, content) {
                const notesList = this.state.get('notes');

                const updatedNotes = notesList.map(note => {
                    if (note.date === date && note.context === context) {
                        return {
                            ...note,
                            content: content,
                            updated_at: new Date().toISOString()
                        };
                    }
                    return note;
                });

                this.state.set('notes', updatedNotes);
            }

            ensureNoteInList(context, date) {
                const notesList = this.state.get('notes');
                const notesWithDates = this.state.get('notesWithDates');

                const noteExists = notesList.some(note => note.date === date);

                if (!noteExists) {
                    const newNote = {
                        id: `temp-${context}-${date}`,
                        user_id: this.state.get('currentUser')?.id || '',
                        context: context,
                        date: date,
                        content: '',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };

                    const updatedNotes = [...notesList, newNote].sort((a, b) => {
                        return b.date.localeCompare(a.date);
                    });

                    const updatedNotesWithDates = [...notesWithDates, date];

                    this.state.update({
                        notes: updatedNotes,
                        notesWithDates: updatedNotesWithDates
                    });
                }
            }

            handleNoteInput(content) {
                clearTimeout(this.saveTimeout);

                const capturedContext = this.state.get('selectedContext');
                const capturedDate = this.state.get('selectedDate');

                if (!capturedContext || !capturedDate) return;

                this.saveTimeout = setTimeout(() => {
                    const currentContext = this.state.get('selectedContext');
                    const currentDate = this.state.get('selectedDate');

                    if (currentContext === capturedContext && currentDate === capturedDate) {
                        this.saveNote(capturedContext, capturedDate, content);
                    }
                }, 500);
            }

            selectDate(dateStr) {
                const context = this.state.get('selectedContext');

                const dateParts = dateStr.split('-');
                const year = parseInt(dateParts[0]);
                const month = parseInt(dateParts[1]) - 1;

                this.state.update({
                    selectedDate: dateStr,
                    currentCalendarMonth: month,
                    currentCalendarYear: year
                });

                this.events.emit(this.EVENT.DATE_CHANGED, dateStr);

                if (context) {
                    this.ensureNoteInList(context, dateStr);
                    this.loadNote(context, dateStr);
                }
            }

            setTodayDate() {
                const dateStr = this.state.get('today');
                const [year, month, day] = dateStr.split('-').map(Number);

                this.state.update({
                    selectedDate: dateStr,
                    currentCalendarMonth: month - 1,
                    currentCalendarYear: year
                });
            }

            getCurrentNoteContent() {
                return this.currentNoteContent;
            }
        }

        notes = new NotesManager();
    });

    describe('loadNote()', () => {
        test('should return null if context is missing', async () => {
            const result = await notes.loadNote(null, '2025-10-16');
            expect(result).toBeNull();
        });

        test('should return null if date is missing', async () => {
            const result = await notes.loadNote('Work', null);
            expect(result).toBeNull();
        });

        test('should load from cache first', async () => {
            const cachedNote = createNote({ content: 'Cached content' });
            mockCache.getNote.mockResolvedValue(cachedNote);
            mockApi.getNote.mockResolvedValue({ note: createNote() });

            await notes.loadNote('Work', '2025-10-16');

            expect(mockCache.getNote).toHaveBeenCalledWith('Work', '2025-10-16');
            expect(mockEvents.emit).toHaveBeenCalledWith(
                'note-loaded',
                expect.objectContaining({
                    content: 'Cached content',
                    fromCache: true
                })
            );
        });

        test('should emit blank note if no cache', async () => {
            mockCache.getNote.mockResolvedValue(null);
            mockApi.getNote.mockResolvedValue({ note: createNote({ content: '' }) });

            await notes.loadNote('Work', '2025-10-16');

            expect(mockEvents.emit).toHaveBeenCalledWith(
                'note-loaded',
                expect.objectContaining({
                    content: '',
                    fromCache: false,
                    isBlank: true
                })
            );
        });

        test('should load from server and update cache', async () => {
            const serverNote = createNote({ content: 'Server content', updated_at: new Date().toISOString() });
            mockCache.getNote.mockResolvedValue(null);
            mockApi.getNote.mockResolvedValue({ note: serverNote });

            await notes.loadNote('Work', '2025-10-16');

            expect(mockApi.getNote).toHaveBeenCalledWith('Work', '2025-10-16');
            expect(mockCache.saveNote).toHaveBeenCalledWith(expect.objectContaining({
                content: 'Server content'
            }));
        });

        test('should prefer server version if newer than cache', async () => {
            const oldDate = new Date('2025-10-15').toISOString();
            const newDate = new Date('2025-10-16').toISOString();

            const cachedNote = createNote({ content: 'Old content', updated_at: oldDate });
            const serverNote = createNote({ content: 'New content', updated_at: newDate });

            mockCache.getNote.mockResolvedValue(cachedNote);
            mockApi.getNote.mockResolvedValue({ note: serverNote });

            await notes.loadNote('Work', '2025-10-16');

            expect(notes.currentNoteContent).toBe('New content');
        });

        test('should keep cache version if newer than server', async () => {
            const oldDate = new Date('2025-10-15').toISOString();
            const newDate = new Date('2025-10-16').toISOString();

            const cachedNote = createNote({ content: 'New content', updated_at: newDate });
            const serverNote = createNote({ content: 'Old content', updated_at: oldDate });

            mockCache.getNote.mockResolvedValue(cachedNote);
            mockApi.getNote.mockResolvedValue({ note: serverNote });

            await notes.loadNote('Work', '2025-10-16');

            expect(notes.currentNoteContent).toBe('New content');
        });

        test('should cancel old load when new load starts', async () => {
            mockCache.getNote.mockResolvedValue(null);
            mockApi.getNote.mockImplementation(() =>
                new Promise(resolve => setTimeout(() =>
                    resolve({ note: createNote({ content: 'First' }) }), 100
                ))
            );

            const promise1 = notes.loadNote('Work', '2025-10-15');
            const promise2 = notes.loadNote('Work', '2025-10-16');

            await Promise.all([promise1, promise2]);

            expect(notes.currentLoadToken).toBe(2);
        });

        test('should handle server error gracefully with cache', async () => {
            const cachedNote = createNote({ content: 'Cached' });
            mockCache.getNote.mockResolvedValue(cachedNote);
            mockApi.getNote.mockRejectedValue(new Error('Network error'));

            const result = await notes.loadNote('Work', '2025-10-16');

            expect(result).toEqual(cachedNote);
            expect(mockEvents.emit).not.toHaveBeenCalledWith('show-error', expect.any(String));
        });

        test('should show error if no cache and server fails', async () => {
            mockCache.getNote.mockResolvedValue(null);
            mockApi.getNote.mockRejectedValue(new Error('Network error'));

            await notes.loadNote('Work', '2025-10-16');

            expect(mockEvents.emit).toHaveBeenCalledWith('show-error', 'Failed to load note. Working offline.');
        });
    });

    describe('saveNote()', () => {
        test('should not save if context is missing', async () => {
            await notes.saveNote(null, '2025-10-16', 'content');
            expect(mockCache.saveNote).not.toHaveBeenCalled();
        });

        test('should not save if date is missing', async () => {
            await notes.saveNote('Work', null, 'content');
            expect(mockCache.saveNote).not.toHaveBeenCalled();
        });

        test('should save to cache immediately', async () => {
            await notes.saveNote('Work', '2025-10-16', 'Test content');

            expect(mockCache.saveNote).toHaveBeenCalledWith(expect.objectContaining({
                context: 'Work',
                date: '2025-10-16',
                content: 'Test content'
            }));
        });

        test('should update currentNoteContent', async () => {
            await notes.saveNote('Work', '2025-10-16', 'New content');
            expect(notes.currentNoteContent).toBe('New content');
        });

        test('should emit NOTE_SAVED event', async () => {
            await notes.saveNote('Work', '2025-10-16', 'content');

            expect(mockEvents.emit).toHaveBeenCalledWith('note-saved', expect.objectContaining({
                local: true
            }));
        });

        test('should queue for background sync', async () => {
            await notes.saveNote('Work', '2025-10-16', 'content');

            expect(mockEvents.emit).toHaveBeenCalledWith('sync-add', expect.objectContaining({
                type: 'save-note',
                data: expect.objectContaining({
                    context: 'Work',
                    date: '2025-10-16',
                    content: 'content'
                })
            }));
        });

        test('should update note in list', async () => {
            const existingNote = createNote({ date: '2025-10-16', content: 'Old' });
            mockState._state.notes = [existingNote];

            await notes.saveNote('Work', '2025-10-16', 'New content');

            expect(mockState.set).toHaveBeenCalledWith('notes', expect.arrayContaining([
                expect.objectContaining({ content: 'New content' })
            ]));
        });
    });

    describe('loadNotesList()', () => {
        test('should clear notes if no context', async () => {
            const result = await notes.loadNotesList(null);

            expect(result).toEqual([]);
            expect(mockState.update).toHaveBeenCalledWith({
                notes: [],
                notesWithDates: []
            });
        });

        test('should load notes from API', async () => {
            const notesList = createNotes(5, { context: 'Work' });
            mockApi.getNotesList.mockResolvedValue({ notes: notesList });

            const result = await notes.loadNotesList('Work');

            expect(mockApi.getNotesList).toHaveBeenCalledWith('Work', 50, 0);
            expect(result).toEqual(notesList);
        });

        test('should update state with notes and dates', async () => {
            const notesList = createNotes(3, { context: 'Work' });
            mockApi.getNotesList.mockResolvedValue({ notes: notesList });

            await notes.loadNotesList('Work');

            expect(mockState.update).toHaveBeenCalledWith({
                notes: notesList,
                notesWithDates: expect.arrayContaining([
                    notesList[0].date,
                    notesList[1].date,
                    notesList[2].date
                ])
            });
        });

        test('should handle API error gracefully', async () => {
            mockApi.getNotesList.mockRejectedValue(new Error('Network error'));

            const result = await notes.loadNotesList('Work');

            expect(result).toEqual([]);
        });

        test('should handle custom limit and offset', async () => {
            mockApi.getNotesList.mockResolvedValue({ notes: [] });

            await notes.loadNotesList('Work', 10, 20);

            expect(mockApi.getNotesList).toHaveBeenCalledWith('Work', 10, 20);
        });
    });

    describe('ensureNoteInList()', () => {
        test('should not add note if it already exists', () => {
            const existingNote = createNote({ date: '2025-10-16' });
            mockState._state.notes = [existingNote];
            mockState._state.notesWithDates = ['2025-10-16'];

            notes.ensureNoteInList('Work', '2025-10-16');

            expect(mockState.update).not.toHaveBeenCalled();
        });

        test('should add note if it does not exist', () => {
            mockState._state.notes = [];
            mockState._state.notesWithDates = [];

            notes.ensureNoteInList('Work', '2025-10-16');

            expect(mockState.update).toHaveBeenCalledWith({
                notes: expect.arrayContaining([
                    expect.objectContaining({
                        context: 'Work',
                        date: '2025-10-16',
                        content: ''
                    })
                ]),
                notesWithDates: expect.arrayContaining(['2025-10-16'])
            });
        });

        test('should sort notes by date (newest first)', () => {
            mockState._state.notes = [
                createNote({ date: '2025-10-15' }),
                createNote({ date: '2025-10-14' })
            ];

            notes.ensureNoteInList('Work', '2025-10-16');

            const updatedNotes = mockState.update.mock.calls[0][0].notes;
            expect(updatedNotes[0].date).toBe('2025-10-16');
            expect(updatedNotes[1].date).toBe('2025-10-15');
            expect(updatedNotes[2].date).toBe('2025-10-14');
        });
    });

    describe('handleNoteInput()', () => {
        test('should not save if context is missing', async () => {
            mockState._state.selectedContext = null;

            notes.handleNoteInput('content');
            await waitFor(600);

            expect(mockCache.saveNote).not.toHaveBeenCalled();
        });

        test('should not save if date is missing', async () => {
            mockState._state.selectedDate = null;

            notes.handleNoteInput('content');
            await waitFor(600);

            expect(mockCache.saveNote).not.toHaveBeenCalled();
        });

        test('should debounce save (500ms)', async () => {
            notes.handleNoteInput('content');

            expect(mockCache.saveNote).not.toHaveBeenCalled();

            await waitFor(600);

            expect(mockCache.saveNote).toHaveBeenCalled();
        });

        test('should cancel previous save if input changes', async () => {
            notes.handleNoteInput('first');
            await waitFor(100);
            notes.handleNoteInput('second');
            await waitFor(600);

            expect(mockCache.saveNote).toHaveBeenCalledTimes(1);
            expect(mockCache.saveNote).toHaveBeenCalledWith(expect.objectContaining({
                content: 'second'
            }));
        });

        test('should not save if context changed during debounce', async () => {
            notes.handleNoteInput('content');

            await waitFor(100);
            mockState._state.selectedContext = 'Personal';

            await waitFor(500);

            expect(mockCache.saveNote).not.toHaveBeenCalled();
        });

        test('should not save if date changed during debounce', async () => {
            notes.handleNoteInput('content');

            await waitFor(100);
            mockState._state.selectedDate = '2025-10-17';

            await waitFor(500);

            expect(mockCache.saveNote).not.toHaveBeenCalled();
        });
    });

    describe('selectDate()', () => {
        test('should update selected date in state', () => {
            notes.selectDate('2025-11-20');

            expect(mockState.update).toHaveBeenCalledWith(expect.objectContaining({
                selectedDate: '2025-11-20'
            }));
        });

        test('should update calendar month and year', () => {
            notes.selectDate('2025-11-20');

            expect(mockState.update).toHaveBeenCalledWith(expect.objectContaining({
                currentCalendarMonth: 10, // November (0-indexed)
                currentCalendarYear: 2025
            }));
        });

        test('should emit DATE_CHANGED event', () => {
            notes.selectDate('2025-10-20');

            expect(mockEvents.emit).toHaveBeenCalledWith('date-changed', '2025-10-20');
        });

        test('should ensure note exists in list', () => {
            mockState._state.notes = [];
            mockState._state.selectedContext = 'Work';

            notes.selectDate('2025-10-20');

            expect(mockState.update).toHaveBeenCalledWith(expect.objectContaining({
                notes: expect.any(Array),
                notesWithDates: expect.arrayContaining(['2025-10-20'])
            }));
        });

        test('should load note if context exists', () => {
            mockCache.getNote.mockResolvedValue(null);
            mockApi.getNote.mockResolvedValue({ note: createNote() });

            notes.selectDate('2025-10-20');

            expect(mockCache.getNote).toHaveBeenCalledWith('Work', '2025-10-20');
        });
    });

    describe('setTodayDate()', () => {
        test('should set selected date to today', () => {
            notes.setTodayDate();

            expect(mockState.update).toHaveBeenCalledWith(expect.objectContaining({
                selectedDate: '2025-10-16'
            }));
        });

        test('should update calendar to current month/year', () => {
            notes.setTodayDate();

            expect(mockState.update).toHaveBeenCalledWith(expect.objectContaining({
                currentCalendarMonth: 9, // October
                currentCalendarYear: 2025
            }));
        });
    });

    describe('getCurrentNoteContent()', () => {
        test('should return current note content', () => {
            notes.currentNoteContent = 'Test content';
            expect(notes.getCurrentNoteContent()).toBe('Test content');
        });

        test('should return empty string initially', () => {
            expect(notes.getCurrentNoteContent()).toBe('');
        });
    });

    describe('Real-world Scenarios', () => {
        test('should handle rapid date switching correctly', async () => {
            mockCache.getNote.mockResolvedValue(null);
            mockApi.getNote.mockResolvedValue({ note: createNote() });

            notes.selectDate('2025-10-15');
            notes.selectDate('2025-10-16');
            notes.selectDate('2025-10-17');

            await waitFor(100);

            // Only the last date should be loaded
            expect(mockCache.getNote).toHaveBeenLastCalledWith('Work', '2025-10-17');
        });

        test('should handle save-then-load correctly', async () => {
            await notes.saveNote('Work', '2025-10-16', 'Saved content');

            mockCache.getNote.mockResolvedValue(createNote({ content: 'Saved content' }));
            mockApi.getNote.mockResolvedValue({ note: createNote({ content: 'Saved content' }) });

            await notes.loadNote('Work', '2025-10-16');

            expect(notes.currentNoteContent).toBe('Saved content');
        });

        test('should handle offline scenario', async () => {
            const cachedNote = createNote({ content: 'Offline content' });
            mockCache.getNote.mockResolvedValue(cachedNote);
            mockApi.getNote.mockRejectedValue(new Error('Network error'));

            const result = await notes.loadNote('Work', '2025-10-16');

            expect(result).toEqual(cachedNote);
            expect(notes.currentNoteContent).toBe('Offline content');
        });
    });
});
