/**
 * Notes Module
 * Handles note loading, saving, and listing
 */

import { state } from '@/utils/state'
import { api } from './api'
import { cache } from '@/utils/cache'
import { events, EVENT } from '@/utils/events'
import type { Note } from '@/types'

class NotesManager {
  private saveTimeout: number | null = null
  private currentNoteContent = ''
  private currentLoadToken = 0 // Token to cancel old load operations
  private currentSelectToken = 0 // Token to cancel old date selection operations

  async loadNote(context: string, date: string): Promise<Note | null> {
    if (!context || !date) {
      return null
    }

    // Increment token to cancel any previous load operations
    const loadToken = ++this.currentLoadToken
    console.log(`[Notes] loadNote started - token: ${loadToken}, context: ${context}, date: ${date}`)

    // Try local cache first (instant load)
    const cachedNote = await cache.getNote(context, date)

    // Validate token before emitting cached content
    if (loadToken !== this.currentLoadToken) {
      console.log(`[Notes] Load cancelled (cache) - token ${loadToken} is stale`)
      return null
    }

    if (cachedNote && cachedNote.content) {
      // Only emit if cache has actual content
      this.currentNoteContent = cachedNote.content
      events.emit(EVENT.NOTE_LOADED, {
        context,
        date,
        content: this.currentNoteContent
      })
    } else {
      // No cached note or empty content - show blank editor immediately
      this.currentNoteContent = ''
      events.emit(EVENT.NOTE_LOADED, {
        context,
        date,
        content: ''
      })
    }

    // Then load from server in background
    try {
      const { note } = await api.getNote(context, date)

      // Validate token before applying server data
      if (loadToken !== this.currentLoadToken) {
        console.log(`[Notes] Load cancelled (server) - token ${loadToken} is stale`)
        return null
      }

      // Determine which version is more recent
      const serverUpdatedAt = note.updated_at ? new Date(note.updated_at).getTime() : 0
      const cachedUpdatedAt = cachedNote?.updated_at ? new Date(cachedNote.updated_at).getTime() : 0

      // Only update if server has newer content OR cache is empty
      const shouldUpdateFromServer =
        !cachedNote ||
        serverUpdatedAt > cachedUpdatedAt ||
        (note.content && !cachedNote.content)

      if (shouldUpdateFromServer) {
        this.currentNoteContent = note.content || ''

        // Update cache with server data
        await cache.saveNote({
          ...note,
          context,
          date,
          content: note.content,
          updated_at: note.updated_at
        })

        // Only emit if content actually changed
        if (!cachedNote || cachedNote.content !== note.content) {
          events.emit(EVENT.NOTE_LOADED, {
            context,
            date,
            content: this.currentNoteContent
          })
        }
      } else {
        console.log('[Notes] Cache is newer than server, keeping cached version')
      }

      return note
    } catch (error) {
      // Validate token before handling error
      if (loadToken !== this.currentLoadToken) {
        console.log(`[Notes] Load cancelled (error) - token ${loadToken} is stale`)
        return null
      }

      // If cached version exists, user already sees it
      if (!cachedNote) {
        console.error('Failed to load note:', error)
        events.emit(EVENT.SHOW_ERROR, {
          message: 'Failed to load note. Working offline.'
        })
      } else {
        console.warn('[Notes] Server unavailable, using cached version')
      }
      return cachedNote
    }
  }

  async saveNote(context: string, date: string, content: string): Promise<void> {
    if (!context || !date) return

    console.log(`[Notes] saveNote called - context: ${context}, date: ${date}, content length: ${content.length}`)

    const now = new Date().toISOString()
    const note = {
      context,
      date,
      content,
      updated_at: now
    }

    // 1. Save to local cache immediately (optimistic)
    await cache.saveNote(note as Note)
    this.currentNoteContent = content

    console.log(`[Notes] Saved to cache and updated currentNoteContent`)

    events.emit(EVENT.NOTE_SAVED, { context, date, content })

    // 2. Update note in the list (update content, keep position)
    this.updateNoteInList(context, date, content)

    // 3. Sync to server immediately (backend will handle Drive sync)
    console.log(`[Notes] Syncing to server - content length: ${content.length}`)
    try {
      await api.saveNote({ context, date, content, updated_at: now })
      console.log(`[Notes] Successfully synced to server`)
    } catch (error) {
      console.error('[Notes] Failed to sync to server:', error)
      // Note is still saved locally in cache, will retry on next app load
    }
  }

  async loadNotesList(context: string, limit = 50, offset = 0): Promise<Note[]> {
    if (!context) {
      state.update({
        notes: [],
        notesWithDates: []
      })
      return []
    }

    try {
      const data = await api.getNotesList(context, limit, offset)
      const serverNotes = data.notes || []

      // Get cached notes from IndexedDB for this context
      const cachedNotes = await cache.getNotesByContext(context)

      // Merge: prioritize server notes, but include cached notes not on server
      const noteMap = new Map<string, Note>()

      // Add all server notes first (authoritative)
      serverNotes.forEach(note => {
        noteMap.set(note.date, note)
      })

      // Add cached notes that don't exist on server (local-only or pending sync)
      cachedNotes.forEach(note => {
        if (!noteMap.has(note.date)) {
          noteMap.set(note.date, note)
        }
      })

      // Convert back to array and sort by date (newest first)
      const mergedNotes = Array.from(noteMap.values()).sort((a, b) => {
        return b.date.localeCompare(a.date)
      })

      const notesWithDates = mergedNotes.map(note => note.date)

      state.update({
        notes: mergedNotes,
        notesWithDates
      })

      return mergedNotes
    } catch (error) {
      console.error('Failed to load notes list:', error)
      return []
    }
  }

  async refreshNotesList(context: string): Promise<void> {
    await this.loadNotesList(context)
  }

  updateNoteInList(context: string, date: string, content: string): void {
    const notes = state.get('notes')

    // Find and update the note
    const updatedNotes = notes.map(note => {
      if (note.date === date && note.context === context) {
        return {
          ...note,
          content: content,
          updated_at: new Date().toISOString()
        }
      }
      return note
    })

    // Update state
    state.set('notes', updatedNotes)
  }

  ensureNoteInList(context: string, date: string): void {
    const notes = state.get('notes')
    const notesWithDates = state.get('notesWithDates')

    // Check if note already exists in the list
    const noteExists = notes.some(note => note.date === date)

    if (!noteExists) {
      // Create a placeholder note in the list
      const newNote: Note = {
        id: `temp-${context}-${date}`,
        user_id: state.get('currentUser')?.id || '',
        context: context,
        date: date,
        content: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      // Add to notes list and sort by date (newest first)
      const updatedNotes = [...notes, newNote].sort((a, b) => {
        return b.date.localeCompare(a.date)
      })

      // Add to dates list
      const updatedNotesWithDates = [...notesWithDates, date]

      // Update state
      state.update({
        notes: updatedNotes,
        notesWithDates: updatedNotesWithDates
      })
    }
  }

  handleNoteInput(content: string): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }

    // Update current content IMMEDIATELY to track user input
    this.currentNoteContent = content

    // Capture current context and date at the time of input
    const capturedContext = state.get('selectedContext')
    const capturedDate = state.get('selectedDate')

    if (!capturedContext || !capturedDate) return

    // Debounce save - reduced from 1000ms to 500ms for better UX
    this.saveTimeout = window.setTimeout(() => {
      // Re-validate that context and date haven't changed
      const currentContext = state.get('selectedContext')
      const currentDate = state.get('selectedDate')

      // Only save if context/date haven't changed
      // We don't check content anymore because currentNoteContent is updated immediately
      if (currentContext === capturedContext && currentDate === capturedDate) {
        console.log(`[Notes] Saving note - context: ${capturedContext}, date: ${capturedDate}`)
        // Use the LATEST content from currentNoteContent, not the captured one
        this.saveNote(capturedContext, capturedDate, this.currentNoteContent)
      } else {
        console.log(
          `[Notes] Save cancelled - context/date changed from ${capturedContext}/${capturedDate} to ${currentContext}/${currentDate}`
        )
      }
    }, 500)
  }

  async selectDate(dateStr: string): Promise<void> {
    // Increment token to cancel any previous select operations
    const selectToken = ++this.currentSelectToken
    console.log(`[Notes] selectDate started - token: ${selectToken}, date: ${dateStr}`)

    const context = state.get('selectedContext')

    // Parse the date
    const dateParts = dateStr.split('-')
    const year = parseInt(dateParts[0])
    const month = parseInt(dateParts[1]) - 1

    // Update calendar month to show the selected date
    state.update({
      selectedDate: dateStr,
      currentCalendarMonth: month,
      currentCalendarYear: year
    })

    // Validate token before proceeding
    if (selectToken !== this.currentSelectToken) {
      console.log(`[Notes] selectDate cancelled - token ${selectToken} is stale`)
      return
    }

    events.emit(EVENT.DATE_CHANGED, { date: dateStr })

    // Load note for this date
    if (context) {
      // Validate token again before loading
      if (selectToken !== this.currentSelectToken) {
        console.log(`[Notes] selectDate cancelled before load - token ${selectToken} is stale`)
        return
      }

      // Create note in local list immediately if it doesn't exist
      this.ensureNoteInList(context, dateStr)
      await this.loadNote(context, dateStr)
    }
  }

  setTodayDate(): void {
    const dateStr = (state as any).get('today') as string
    const [year, month] = dateStr.split('-').map(Number)

    state.update({
      selectedDate: dateStr,
      currentCalendarMonth: month - 1,
      currentCalendarYear: year
    })
  }

  getCurrentNoteContent(): string {
    return this.currentNoteContent
  }

  async deleteNote(context: string, date: string): Promise<void> {
    if (!context || !date) return

    console.log(`[Notes] Deleting note - context: ${context}, date: ${date}`)

    // Cancel any pending save operations for this note
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
      console.log('[Notes] Cancelled pending save operation')
    }

    // 1. Remove from local cache immediately (optimistic)
    await cache.deleteNote(context, date)

    // 2. Remove from the notes list in state
    const notes = state.get('notes')
    const updatedNotes = notes.filter(note => !(note.date === date && note.context === context))

    const notesWithDates = state.get('notesWithDates')
    const updatedNotesWithDates = notesWithDates.filter(d => d !== date)

    state.update({
      notes: updatedNotes,
      notesWithDates: updatedNotesWithDates
    })

    // 3. If the deleted note was currently selected, clear the editor and select another note
    const selectedDate = state.get('selectedDate')
    if (selectedDate === date) {
      // Clear current note content IMMEDIATELY to prevent race conditions
      this.currentNoteContent = ''

      // Select the most recent note or today
      if (updatedNotes.length > 0) {
        // Select the first note (most recent)
        const nextNote = updatedNotes[0]
        await this.selectDate(nextNote.date)
      } else {
        // No notes left, select today and clear editor
        this.setTodayDate()
        events.emit(EVENT.NOTE_LOADED, {
          context,
          date,
          content: ''
        })
      }
    }

    // 4. Sync deletion to server immediately (backend will handle Drive sync)
    try {
      await api.deleteNote(context, date)
      console.log('[Notes] Note deleted from server')
    } catch (error) {
      console.error('[Notes] Failed to delete note from server:', error)
      // Note is still deleted locally, server will sync on next app load
    }

    console.log('[Notes] Note deleted locally and synced')
  }
}

export const notes = new NotesManager()
