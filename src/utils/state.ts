/**
 * Mini State Manager
 * Simple reactive state management without a framework
 */

import type { User, UserSettings, Context, Note } from '@/types'

interface AppState {
  // User state
  currentUser: User | null
  userSettings: UserSettings

  // Selection state
  selectedContext: string | null
  selectedDate: string | null

  // Data state
  contexts: Context[]
  notes: Note[]
  notesWithDates: string[]

  // Calendar state
  currentCalendarMonth: number
  currentCalendarYear: number

  // UI state
  isLoggingOut: boolean
  syncStatus: { pending: number; syncing: boolean }

  // Time
  serverTimeOffset: number
}

type StateKey = keyof AppState
type StateListener<K extends StateKey> = (newValue: AppState[K], oldValue: AppState[K]) => void
type WildcardListener = (key: StateKey, newValue: any, oldValue: any) => void
type ComputedFn<T> = (state: AppState) => T

class StateManager {
  private _state: AppState
  private _listeners: Map<StateKey | '*', Set<StateListener<any> | WildcardListener>>
  private _computed: Map<string, ComputedFn<any>>

  constructor() {
    this._state = {
      // User state
      currentUser: null,
      userSettings: {
        theme: 'dark',
        weekStart: 0,
        timezone: 'UTC',
        dateFormat: 'DD-MM-YY',
        uniqueContextMode: false,
        showBreadcrumb: false,
        showMarkdownEditor: false,
        hideNewContextButton: false
      },

      // Selection state
      selectedContext: null,
      selectedDate: null,

      // Data state
      contexts: [],
      notes: [],
      notesWithDates: [],

      // Calendar state
      currentCalendarMonth: new Date().getMonth(),
      currentCalendarYear: new Date().getFullYear(),

      // UI state
      isLoggingOut: false,
      syncStatus: { pending: 0, syncing: false },

      // Time
      serverTimeOffset: 0
    }

    this._listeners = new Map()
    this._computed = new Map()
  }

  /**
   * Get state value
   */
  get<K extends StateKey>(key: K): AppState[K]
  get(key: string): any {
    if (this._computed.has(key)) {
      return this._computed.get(key)!(this._state)
    }
    return this._state[key as StateKey]
  }

  /**
   * Set state value and notify listeners
   */
  set<K extends StateKey>(key: K, value: AppState[K]): void {
    const oldValue = this._state[key]
    if (oldValue === value) return

    this._state[key] = value
    this._notify(key, value, oldValue)
  }

  /**
   * Update multiple state values at once
   */
  update(changes: Partial<AppState>): void {
    Object.entries(changes).forEach(([key, value]) => {
      this.set(key as StateKey, value)
    })
  }

  /**
   * Subscribe to state changes
   */
  subscribe<K extends StateKey>(key: K, callback: StateListener<K>): () => void
  subscribe(key: '*', callback: WildcardListener): () => void
  subscribe(key: StateKey | '*', callback: any): () => void {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set())
    }
    this._listeners.get(key)!.add(callback)

    // Return unsubscribe function
    return () => {
      const listeners = this._listeners.get(key)
      if (listeners) {
        listeners.delete(callback)
      }
    }
  }

  /**
   * Subscribe to multiple keys
   */
  subscribeMany(keys: StateKey[], callback: WildcardListener): () => void {
    const unsubscribers = keys.map(key => this.subscribe(key, callback as any))
    return () => unsubscribers.forEach(unsub => unsub())
  }

  /**
   * Define computed property
   */
  computed<T>(key: string, fn: ComputedFn<T>): void {
    this._computed.set(key, fn)
  }

  /**
   * Get entire state (for debugging)
   */
  getState(): AppState {
    return { ...this._state }
  }

  /**
   * Notify listeners of change
   */
  private _notify<K extends StateKey>(key: K, newValue: AppState[K], oldValue: AppState[K]): void {
    const listeners = this._listeners.get(key)
    if (listeners) {
      listeners.forEach(callback => {
        try {
          ;(callback as StateListener<K>)(newValue, oldValue)
        } catch (error) {
          console.error(`Error in state listener for "${key}":`, error)
        }
      })
    }

    // Notify wildcard listeners (*)
    const wildcardListeners = this._listeners.get('*')
    if (wildcardListeners) {
      wildcardListeners.forEach(callback => {
        try {
          ;(callback as WildcardListener)(key, newValue as any, oldValue)
        } catch (error) {
          console.error('Error in wildcard state listener:', error)
        }
      })
    }
  }
}

// Create singleton instance
export const state = new StateManager()

// Setup computed properties
state.computed('today', (s) => {
  const timezone = s.userSettings.timezone || 'UTC'
  const now = new Date(Date.now() + s.serverTimeOffset)

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const parts = formatter.formatToParts(now)
  const year = parts.find(p => p.type === 'year')!.value
  const month = parts.find(p => p.type === 'month')!.value
  const day = parts.find(p => p.type === 'day')!.value

  return `${year}-${month}-${day}`
})

// Debug helper
if (typeof window !== 'undefined') {
  ;(window as any).__STATE__ = state
}
