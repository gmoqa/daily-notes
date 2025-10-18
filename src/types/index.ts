// Core types for the application

export interface UserSettings {
  theme: 'light' | 'dark'
  weekStart: number
  timezone: string
  dateFormat: string
  uniqueContextMode: boolean
  showBreadcrumb: boolean
  showMarkdownEditor: boolean
  hideNewContextButton: boolean
}

export interface User {
  id: string
  email: string
  name: string
  picture: string
  settings: UserSettings
}

export interface Note {
  id: string
  user_id: string
  context: string
  date: string
  content: string
  sync_status?: string
  sync_error?: string
  created_at: string
  updated_at: string
}

export interface Context {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
}

export interface SyncStatus {
  pending_count: number
  failed_count: number
  failed_notes: Note[]
}

export interface AppState {
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
  today: string
}
