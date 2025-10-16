/**
 * Notes Module
 * Handles note loading, saving, and listing
 */

import { state } from './state.js';
import { api } from './api.js';
import { cache } from './cache.js';
import { events, EVENT } from './events.js';

class NotesManager {
    constructor() {
        this.saveTimeout = null;
        this.currentNoteContent = '';
        this.currentLoadToken = 0; // Token to cancel old load operations
    }

    async loadNote(context, date) {
        if (!context || !date) {
            return null;
        }

        // Increment token to cancel any previous load operations
        const loadToken = ++this.currentLoadToken;
        console.log(`[Notes] loadNote started - token: ${loadToken}, context: ${context}, date: ${date}`);

        // Try local cache first (instant load)
        const cachedNote = await cache.getNote(context, date);

        // Validate token before emitting cached content
        if (loadToken !== this.currentLoadToken) {
            console.log(`[Notes] Load cancelled (cache) - token ${loadToken} is stale`);
            return null;
        }

        if (cachedNote && cachedNote.content) {
            // Only emit if cache has actual content
            this.currentNoteContent = cachedNote.content;
            events.emit(EVENT.NOTE_LOADED, {
                content: this.currentNoteContent,
                fromCache: true,
                cachedAt: cachedNote._cachedAt
            });
        } else {
            // No cached note or empty content - show blank editor immediately
            this.currentNoteContent = '';
            events.emit(EVENT.NOTE_LOADED, {
                content: '',
                fromCache: false,
                isBlank: true
            });
        }

        // Then load from server in background
        try {
            const { note } = await api.getNote(context, date);

            // Validate token before applying server data
            if (loadToken !== this.currentLoadToken) {
                console.log(`[Notes] Load cancelled (server) - token ${loadToken} is stale`);
                return null;
            }

            // Determine which version is more recent
            const serverUpdatedAt = note.updated_at ? new Date(note.updated_at).getTime() : 0;
            const cachedUpdatedAt = cachedNote?.updated_at ? new Date(cachedNote.updated_at).getTime() : 0;

            // Only update if server has newer content OR cache is empty
            const shouldUpdateFromServer = !cachedNote ||
                                         serverUpdatedAt > cachedUpdatedAt ||
                                         (note.content && !cachedNote.content);

            if (shouldUpdateFromServer) {
                this.currentNoteContent = note.content || '';

                // Update cache with server data
                await cache.saveNote({
                    context,
                    date,
                    content: note.content,
                    updated_at: note.updated_at
                });

                // Only emit if content actually changed
                if (!cachedNote || cachedNote.content !== note.content) {
                    events.emit(EVENT.NOTE_LOADED, {
                        content: this.currentNoteContent,
                        fromCache: false,
                        serverUpdatedAt: note.updated_at
                    });
                }
            } else {
                console.log('[Notes] Cache is newer than server, keeping cached version');
            }

            return note;
        } catch (error) {
            // Validate token before handling error
            if (loadToken !== this.currentLoadToken) {
                console.log(`[Notes] Load cancelled (error) - token ${loadToken} is stale`);
                return null;
            }

            // If cached version exists, user already sees it
            if (!cachedNote) {
                console.error('Failed to load note:', error);
                events.emit(EVENT.SHOW_ERROR, 'Failed to load note. Working offline.');
            } else {
                console.warn('[Notes] Server unavailable, using cached version');
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

        // 1. Save to local cache immediately (optimistic)
        await cache.saveNote(note);
        this.currentNoteContent = content;

        events.emit(EVENT.NOTE_SAVED, { local: true, timestamp: now });

        // 2. Update note in the list (update content, keep position)
        this.updateNoteInList(context, date, content);

        // 3. Queue for background sync with Drive
        events.emit('sync-add', {
            type: 'save-note',
            data: note,
            timestamp: now
        });
    }

    async loadNotesList(context, limit = 50, offset = 0) {
        if (!context) {
            state.update({
                notes: [],
                notesWithDates: []
            });
            return [];
        }

        try {
            const data = await api.getNotesList(context, limit, offset);
            const notes = data.notes || [];

            const notesWithDates = notes.map(note => note.date);

            state.update({
                notes,
                notesWithDates
            });

            return notes;
        } catch (error) {
            console.error('Failed to load notes list:', error);
            return [];
        }
    }

    async refreshNotesList(context) {
        await this.loadNotesList(context);
    }

    updateNoteInList(context, date, content) {
        const notes = state.get('notes');

        // Find and update the note
        const updatedNotes = notes.map(note => {
            if (note.date === date && note.context === context) {
                return {
                    ...note,
                    content: content,
                    updated_at: new Date().toISOString()
                };
            }
            return note;
        });

        // Update state
        state.set('notes', updatedNotes);
    }

    ensureNoteInList(context, date) {
        const notes = state.get('notes');
        const notesWithDates = state.get('notesWithDates');

        // Check if note already exists in the list
        const noteExists = notes.some(note => note.date === date);

        if (!noteExists) {
            // Create a placeholder note in the list
            const newNote = {
                id: `temp-${context}-${date}`,
                user_id: state.get('currentUser')?.id || '',
                context: context,
                date: date,
                content: '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            // Add to notes list and sort by date (newest first)
            const updatedNotes = [...notes, newNote].sort((a, b) => {
                return b.date.localeCompare(a.date);
            });

            // Add to dates list
            const updatedNotesWithDates = [...notesWithDates, date];

            // Update state
            state.update({
                notes: updatedNotes,
                notesWithDates: updatedNotesWithDates
            });
        }
    }

    handleNoteInput(content) {
        clearTimeout(this.saveTimeout);

        // Capture current context and date at the time of input
        const capturedContext = state.get('selectedContext');
        const capturedDate = state.get('selectedDate');

        if (!capturedContext || !capturedDate) return;

        // Debounce save - reduced from 1000ms to 500ms for better UX
        this.saveTimeout = setTimeout(() => {
            // Re-validate that context and date haven't changed
            const currentContext = state.get('selectedContext');
            const currentDate = state.get('selectedDate');

            if (currentContext === capturedContext && currentDate === capturedDate) {
                console.log(`[Notes] Saving note - context: ${capturedContext}, date: ${capturedDate}`);
                this.saveNote(capturedContext, capturedDate, content);
            } else {
                console.log(`[Notes] Save cancelled - context/date changed from ${capturedContext}/${capturedDate} to ${currentContext}/${currentDate}`);
            }
        }, 500);
    }

    selectDate(dateStr) {
        const context = state.get('selectedContext');

        // Parse the date
        const dateParts = dateStr.split('-');
        const year = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]) - 1;

        // Update calendar month to show the selected date
        state.update({
            selectedDate: dateStr,
            currentCalendarMonth: month,
            currentCalendarYear: year
        });

        events.emit(EVENT.DATE_CHANGED, dateStr);

        // Load note for this date
        if (context) {
            // Create note in local list immediately if it doesn't exist
            this.ensureNoteInList(context, dateStr);
            this.loadNote(context, dateStr);
        }
    }

    setTodayDate() {
        const dateStr = state.get('today');
        const [year, month, day] = dateStr.split('-').map(Number);

        state.update({
            selectedDate: dateStr,
            currentCalendarMonth: month - 1,
            currentCalendarYear: year
        });
    }

    getCurrentNoteContent() {
        return this.currentNoteContent;
    }
}

export const notes = new NotesManager();
