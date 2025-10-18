/**
 * Local Cache Module
 * IndexedDB-based offline storage for notes and contexts
 */

import type { Note, Context } from '@/types'

interface CachedNote extends Note {
  id: string
  _localTimestamp: number
  _cachedAt: number
}

interface CachedContext extends Context {
  _localTimestamp: number
}

export class LocalCache {
  private db: IDBDatabase | null = null
  private dbName = 'DailyNotesDB'
  private version = 1

  // Batch write optimization
  private pendingWrites = new Map<string, CachedNote>()
  private writeTimer: number | null = null
  private readonly BATCH_DELAY = 500 // ms

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result

        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains('contexts')) {
          db.createObjectStore('contexts', { keyPath: 'id' })
        }
      }
    })
  }

  async saveNote(note: Note): Promise<void> {
    if (!this.db) return

    const id = `${note.context}-${note.date}`

    // Add to pending writes (batching)
    this.pendingWrites.set(id, {
      ...note,
      id,
      _localTimestamp: Date.now(),
      _cachedAt: Date.now(),
      updated_at: note.updated_at || new Date().toISOString()
    })

    // Schedule batch write
    this.scheduleBatchWrite()
  }

  private scheduleBatchWrite(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
    }

    this.writeTimer = window.setTimeout(() => {
      this.flushPendingWrites()
    }, this.BATCH_DELAY)
  }

  private async flushPendingWrites(): Promise<void> {
    if (!this.db || this.pendingWrites.size === 0) return

    const notesToWrite = Array.from(this.pendingWrites.values())
    this.pendingWrites.clear()

    const tx = this.db.transaction(['notes'], 'readwrite')
    const store = tx.objectStore('notes')

    notesToWrite.forEach(note => {
      store.put(note)
    })

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`[Cache] Batch wrote ${notesToWrite.length} note(s)`)
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    })
  }

  // Force immediate write (for critical operations)
  async saveNoteImmediate(note: Note): Promise<void> {
    if (!this.db) return

    const tx = this.db.transaction(['notes'], 'readwrite')
    const store = tx.objectStore('notes')
    const id = `${note.context}-${note.date}`

    store.put({
      ...note,
      id,
      _localTimestamp: Date.now(),
      _cachedAt: Date.now(),
      updated_at: note.updated_at || new Date().toISOString()
    })

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getNote(context: string, date: string): Promise<CachedNote | null> {
    if (!this.db) return null

    const tx = this.db.transaction(['notes'], 'readonly')
    const store = tx.objectStore('notes')
    const id = `${context}-${date}`

    return new Promise((resolve) => {
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => resolve(null)
    })
  }

  async saveNotes(notes: Note[]): Promise<void> {
    if (!this.db) return

    const tx = this.db.transaction(['notes'], 'readwrite')
    const store = tx.objectStore('notes')
    const now = Date.now()

    notes.forEach(note => {
      const id = `${note.context}-${note.date}`
      store.put({
        ...note,
        id,
        _localTimestamp: now,
        _cachedAt: now,
        updated_at: note.updated_at || new Date().toISOString()
      })
    })

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getNotesByContext(context: string): Promise<CachedNote[]> {
    if (!this.db) return []

    const tx = this.db.transaction(['notes'], 'readonly')
    const store = tx.objectStore('notes')

    return new Promise((resolve) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const allNotes = request.result || []
        resolve(allNotes.filter(n => n.context === context))
      }
      request.onerror = () => resolve([])
    })
  }

  async saveContexts(contexts: Context[] | null | undefined): Promise<void> {
    if (!this.db) return

    // Handle null/undefined contexts
    if (!contexts || !Array.isArray(contexts)) {
      console.warn('[Cache] saveContexts called with invalid contexts:', contexts)
      return
    }

    const tx = this.db.transaction(['contexts'], 'readwrite')
    const store = tx.objectStore('contexts')

    contexts.forEach(ctx => {
      store.put({
        ...ctx,
        _localTimestamp: Date.now()
      })
    })

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getContexts(): Promise<CachedContext[]> {
    if (!this.db) return []

    const tx = this.db.transaction(['contexts'], 'readonly')
    const store = tx.objectStore('contexts')

    return new Promise((resolve) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => resolve([])
    })
  }

  async deleteNote(context: string, date: string): Promise<void> {
    if (!this.db) return

    const id = `${context}-${date}`

    // Remove from pending writes if it's there
    this.pendingWrites.delete(id)

    const tx = this.db.transaction(['notes'], 'readwrite')
    const store = tx.objectStore('notes')

    store.delete(id)

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`[Cache] Deleted note: ${id}`)
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    })
  }

  async clear(): Promise<void> {
    if (!this.db) return

    const tx = this.db.transaction(['notes', 'contexts'], 'readwrite')

    tx.objectStore('notes').clear()
    tx.objectStore('contexts').clear()

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

// Create singleton instance
export const cache = new LocalCache()
