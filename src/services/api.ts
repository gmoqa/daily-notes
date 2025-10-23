/**
 * API Client Module
 * Handles all backend communication
 */

import { state } from '@/utils/state'
import { events, EVENT } from '@/utils/events'
import type { User, Context, Note, UserSettings } from '@/types'

interface AuthResponse {
  authenticated: boolean
  user?: User
}

interface LoginResponse {
  success: boolean
  user?: User
  error?: string
}

interface NoteResponse {
  note: Note
}

interface NotesListResponse {
  notes: Note[]
  total?: number
}

interface ContextsResponse {
  contexts: Context[]
}

interface ServerTimeResponse {
  timestamp: number  // Unix timestamp in seconds
  timezone: string
  iso: string
}

export class APIClient {
  // Base URL is empty string since we use relative paths
  // private baseUrl = ''

  async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      const response = await fetch(endpoint, {
        ...options,
        headers: {
          ...options.headers,
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin'
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }

        if (response.status === 401 || response.status === 403) {
          if (!state.get('isLoggingOut')) {
            // Check if this is a note-related request
            const isNoteRequest = endpoint.includes('/api/notes')
            const message = isNoteRequest
              ? 'Session expired. Your notes are saved locally and will sync when you sign in again.'
              : 'Session expired. Please login again.'

            events.emit(EVENT.SHOW_ERROR, { message })
            events.emit('session-expired' as any, { isNoteRequest })
          }
          state.set('currentUser', null)
          throw new Error('Session expired')
        }

        throw new Error(data.error || `Request failed with status ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      if (!state.get('isLoggingOut')) {
        // Don't show error notification if it's already been handled
        if (error instanceof Error && !error.message.includes('Session expired')) {
          events.emit(EVENT.SHOW_ERROR, {
            message: error.message || 'An error occurred'
          })
        }
      }
      throw error
    }
  }

  // Auth endpoints
  async checkAuth(): Promise<AuthResponse> {
    try {
      const response = await fetch('/api/auth/me')
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Auth check failed:', error)
      return { authenticated: false }
    }
  }

  async login(accessToken: string, expiresIn?: number): Promise<LoginResponse> {
    return await this.request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        access_token: accessToken,
        expires_in: expiresIn || 3600
      })
    })
  }

  async loginWithCode(code: string): Promise<LoginResponse> {
    return await this.request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ code })
    })
  }

  async loginWithToken(idToken: string): Promise<LoginResponse> {
    return await this.request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken })
    })
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', {
      method: 'POST'
    })
  }

  // Contexts endpoints
  async getContexts(): Promise<ContextsResponse> {
    return await this.request<ContextsResponse>('/api/contexts')
  }

  async createContext(data: { name: string; color?: string }): Promise<Context> {
    return await this.request<Context>('/api/contexts', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateContext(id: string, data: { name?: string; color?: string }): Promise<Context> {
    return await this.request<Context>(`/api/contexts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteContext(id: string): Promise<void> {
    await this.request(`/api/contexts/${id}`, {
      method: 'DELETE'
    })
  }

  // Notes endpoints
  async getNote(context: string, date: string): Promise<NoteResponse> {
    return await this.request<NoteResponse>(
      `/api/notes?context=${encodeURIComponent(context)}&date=${date}`
    )
  }

  async saveNote(data: { context: string; date: string; content: string; updated_at?: string }): Promise<Note> {
    return await this.request<Note>('/api/notes', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async getNotesList(context: string, limit = 50, offset = 0): Promise<NotesListResponse> {
    return await this.request<NotesListResponse>(
      `/api/notes/list?context=${encodeURIComponent(context)}&limit=${limit}&offset=${offset}`
    )
  }

  async deleteNote(context: string, date: string): Promise<void> {
    const encodedContext = encodeURIComponent(context)
    const encodedDate = encodeURIComponent(date)

    await this.request(`/api/notes/${encodedContext}/${encodedDate}`, {
      method: 'DELETE'
    })
  }

  // Settings endpoints
  async updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    return await this.request<UserSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    })
  }

  // Time sync
  async getServerTime(timezone: string): Promise<ServerTimeResponse> {
    const response = await fetch(`/api/time?timezone=${encodeURIComponent(timezone)}`)
    return await response.json()
  }
}

export const api = new APIClient()
