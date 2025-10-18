/**
 * Event Bus
 * Central event system for app-wide communication
 */

// Event detail types
interface NoteEventDetail {
  context: string
  date: string
  content?: string
}

interface SyncStatusDetail {
  pending: number
  syncing: boolean
}

interface ErrorEventDetail {
  message: string
  error?: Error
}

interface SuccessEventDetail {
  message: string
}

// Event type mapping
interface EventTypeMap {
  // Notes
  'note-cached': NoteEventDetail
  'note-loaded': NoteEventDetail
  'note-saved': NoteEventDetail
  'note-changed': NoteEventDetail

  // Sync
  'sync-status': SyncStatusDetail
  'operation-synced': { operationId: string }
  'sync-error': ErrorEventDetail

  // Context
  'context-changed': { context: string | null }
  'contexts-loaded': { contexts: any[] }

  // Date
  'date-changed': { date: string }

  // UI
  'show-error': ErrorEventDetail
  'show-success': SuccessEventDetail
}

type EventName = keyof EventTypeMap
type EventDetail<T extends EventName> = EventTypeMap[T]

class EventBus extends EventTarget {
  /**
   * Emit a typed event
   */
  emit<T extends EventName>(eventName: T, detail: EventDetail<T>): void {
    this.dispatchEvent(new CustomEvent(eventName, { detail }))
  }

  /**
   * Listen to a typed event
   */
  on<T extends EventName>(
    eventName: T,
    callback: (event: CustomEvent<EventDetail<T>>) => void
  ): () => void {
    const listener = callback as EventListener
    this.addEventListener(eventName, listener)
    return () => this.removeEventListener(eventName, listener)
  }

  /**
   * Listen to an event once
   */
  once<T extends EventName>(
    eventName: T,
    callback: (event: CustomEvent<EventDetail<T>>) => void
  ): () => void {
    const listener = callback as EventListener
    const handler = (event: Event) => {
      listener(event)
      this.removeEventListener(eventName, handler)
    }
    this.addEventListener(eventName, handler)
    return () => this.removeEventListener(eventName, handler)
  }
}

export const events = new EventBus()

// Event names for easy reference and autocomplete
export const EVENT = {
  // Notes
  NOTE_CACHED: 'note-cached' as const,
  NOTE_LOADED: 'note-loaded' as const,
  NOTE_SAVED: 'note-saved' as const,
  NOTE_CHANGED: 'note-changed' as const,

  // Sync
  SYNC_STATUS: 'sync-status' as const,
  OPERATION_SYNCED: 'operation-synced' as const,
  SYNC_ERROR: 'sync-error' as const,

  // Context
  CONTEXT_CHANGED: 'context-changed' as const,
  CONTEXTS_LOADED: 'contexts-loaded' as const,

  // Date
  DATE_CHANGED: 'date-changed' as const,

  // UI
  SHOW_ERROR: 'show-error' as const,
  SHOW_SUCCESS: 'show-success' as const
} as const
