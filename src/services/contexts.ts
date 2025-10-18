/**
 * Contexts Module
 * Handles context (project) management
 */

import { state } from '@/utils/state'
import { api } from './api'
import { cache } from '@/utils/cache'
import { events, EVENT } from '@/utils/events'
import type { Context } from '@/types'

class ContextsManager {
  async loadContexts(): Promise<void> {
    // Try local cache first (instant)
    const cachedContexts = await cache.getContexts()
    console.log('[CONTEXTS] Cached contexts:', cachedContexts)
    if (cachedContexts.length > 0) {
      state.set('contexts', cachedContexts)
    }

    // Load from server in background
    try {
      console.log('[CONTEXTS] Fetching contexts from server...')
      const response = await api.getContexts()
      console.log('[CONTEXTS] Server response:', response)
      // Handle null/undefined contexts gracefully
      const contexts = response?.contexts || []
      console.log('[CONTEXTS] Parsed contexts:', contexts)
      await cache.saveContexts(contexts)
      state.set('contexts', contexts)
      events.emit(EVENT.CONTEXTS_LOADED, { contexts })
    } catch (error) {
      console.error('[CONTEXTS] Failed to load contexts from server:', error)
      // Only show error if we have no contexts at all AND it's a real network error
      if (cachedContexts.length === 0 && !navigator.onLine) {
        events.emit(EVENT.SHOW_ERROR, {
          message: 'Failed to load contexts. Working offline.'
        })
      }
      // If online but failed, don't show error - user might just have 0 contexts
    }
  }

  async createContext(name: string, color?: string): Promise<Context> {
    const newContext: Context = {
      id: `temp-${Date.now()}`,
      user_id: state.get('currentUser')?.id || '',
      name,
      color: color || 'primary',
      created_at: new Date().toISOString()
    }

    // 1. Update UI immediately (optimistic)
    const currentContexts = state.get('contexts')
    const updatedContexts = [...currentContexts, newContext]

    await cache.saveContexts(updatedContexts)
    state.set('contexts', updatedContexts)
    state.set('selectedContext', name)

    // 2. Sync to server immediately
    try {
      await api.createContext({ name, color })
      console.log('[CONTEXTS] Successfully synced new context to server')
      // Reload contexts to get server-assigned ID
      await this.loadContexts()
    } catch (error) {
      console.error('[CONTEXTS] Failed to sync context to server:', error)
      // Context is still saved locally, will retry on next app load
    }

    return newContext
  }

  async updateContext(contextId: string, name: string, color: string): Promise<boolean> {
    try {
      await api.updateContext(contextId, { name, color })

      // Update local state
      const currentContexts = state.get('contexts')
      const updatedContexts = currentContexts.map(c => (c.id === contextId ? { ...c, name, color } : c))

      await cache.saveContexts(updatedContexts)
      state.set('contexts', updatedContexts)

      // Update selected context if it was the one being edited
      const selectedContext = state.get('selectedContext')
      const oldContext = currentContexts.find(c => c.id === contextId)
      if (selectedContext === oldContext?.name) {
        state.set('selectedContext', name)
        localStorage.setItem('lastContext', name)
      }

      events.emit(EVENT.SHOW_SUCCESS, { message: 'Context updated successfully' })
      return true
    } catch (error) {
      events.emit(EVENT.SHOW_ERROR, { message: 'Failed to update context' })
      return false
    }
  }

  async deleteContext(contextId: string): Promise<void> {
    try {
      await api.deleteContext(contextId)

      const currentContexts = state.get('contexts')
      const updatedContexts = currentContexts.filter(c => c.id !== contextId)

      await cache.saveContexts(updatedContexts)
      state.set('contexts', updatedContexts)

      events.emit(EVENT.SHOW_SUCCESS, { message: 'Context deleted successfully' })
    } catch (error) {
      events.emit(EVENT.SHOW_ERROR, { message: 'Failed to delete context' })
    }
  }

  selectContext(contextName: string | null): void {
    state.set('selectedContext', contextName)
    events.emit(EVENT.CONTEXT_CHANGED, { context: contextName })

    // Save last used context to localStorage
    if (contextName) {
      localStorage.setItem('lastContext', contextName)
    }
  }

  getSelectedContext(): string | null {
    return state.get('selectedContext')
  }

  getContextColor(contextName: string): string {
    const contexts = state.get('contexts')
    const context = contexts.find(c => c.name === contextName)
    // Normalize old hex colors
    const color = context?.color || 'primary'
    const bulmaColors = ['text', 'link', 'primary', 'info', 'success', 'warning', 'danger']
    return bulmaColors.includes(color) ? color : 'primary'
  }

  restoreLastContext(): string | null {
    const contexts = state.get('contexts')
    const settings = state.get('userSettings')
    const uniqueContextMode = settings.uniqueContextMode || false

    console.log('[CONTEXTS] restoreLastContext - contexts:', contexts)
    console.log('[CONTEXTS] uniqueContextMode:', uniqueContextMode)

    // If no contexts available, return null
    if (!contexts || contexts.length === 0) {
      console.log('[CONTEXTS] No contexts available')
      return null
    }

    // If unique context mode is enabled, always select first context
    if (uniqueContextMode) {
      const firstContext = contexts[0].name
      console.log('[CONTEXTS] Unique context mode - selecting first context:', firstContext)
      this.selectContext(firstContext)
      return firstContext
    }

    const lastContext = localStorage.getItem('lastContext')
    console.log('[CONTEXTS] lastContext from localStorage:', lastContext)

    // Try to restore last used context
    if (lastContext) {
      const contextExists = contexts.some(c => c.name === lastContext)
      console.log('[CONTEXTS] lastContext exists?', contextExists)
      if (contextExists) {
        console.log('[CONTEXTS] Selecting last context:', lastContext)
        this.selectContext(lastContext)
        return lastContext
      }
    }

    // If no last context or it doesn't exist, select first context
    const firstContext = contexts[0].name
    console.log('[CONTEXTS] Selecting first context:', firstContext)
    this.selectContext(firstContext)
    return firstContext
  }
}

export const contexts = new ContextsManager()
