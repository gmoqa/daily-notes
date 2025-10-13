/**
 * Contexts Module
 * Handles context (project) management
 */

import { state } from './state.js';
import { api } from './api.js';
import { cache } from './cache.js';
import { events, EVENT } from './events.js';

class ContextsManager {
    async loadContexts() {
        // Try local cache first (instant)
        const cachedContexts = await cache.getContexts();
        if (cachedContexts.length > 0) {
            state.set('contexts', cachedContexts);
        }

        // Load from server in background
        try {
            const { contexts } = await api.getContexts();
            await cache.saveContexts(contexts);
            state.set('contexts', contexts);
            events.emit(EVENT.CONTEXTS_LOADED, contexts);
        } catch (error) {
            if (cachedContexts.length === 0) {
                events.emit(EVENT.SHOW_ERROR, 'Failed to load contexts. Working offline.');
            }
        }
    }

    async createContext(name, color) {
        const newContext = {
            id: `temp-${Date.now()}`,
            name,
            color: color || '#485fc7',
            created_at: new Date().toISOString()
        };

        // 1. Update UI immediately (optimistic)
        const currentContexts = state.get('contexts');
        const updatedContexts = [...currentContexts, newContext];

        await cache.saveContexts(updatedContexts);
        state.set('contexts', updatedContexts);
        state.set('selectedContext', name);

        // 2. Queue for background sync
        events.emit('sync-add', {
            type: 'create-context',
            data: { name, color }
        });

        return newContext;
    }

    async deleteContext(contextId) {
        try {
            await api.deleteContext(contextId);

            const currentContexts = state.get('contexts');
            const updatedContexts = currentContexts.filter(c => c.id !== contextId);

            await cache.saveContexts(updatedContexts);
            state.set('contexts', updatedContexts);

            events.emit(EVENT.SHOW_SUCCESS, 'Context deleted successfully');
        } catch (error) {
            events.emit(EVENT.SHOW_ERROR, 'Failed to delete context');
        }
    }

    selectContext(contextName) {
        state.set('selectedContext', contextName);
        events.emit(EVENT.CONTEXT_CHANGED, contextName);

        // Save last used context to localStorage
        if (contextName) {
            localStorage.setItem('lastContext', contextName);
        }
    }

    getSelectedContext() {
        return state.get('selectedContext');
    }

    getContextColor(contextName) {
        const contexts = state.get('contexts');
        const context = contexts.find(c => c.name === contextName);
        return context?.color || '#485fc7';
    }

    restoreLastContext() {
        const contexts = state.get('contexts');
        const settings = state.get('userSettings');
        const uniqueContextMode = settings.uniqueContextMode || false;

        console.log('[CONTEXTS] restoreLastContext - contexts:', contexts);
        console.log('[CONTEXTS] uniqueContextMode:', uniqueContextMode);

        // If no contexts available, return null
        if (!contexts || contexts.length === 0) {
            console.log('[CONTEXTS] No contexts available');
            return null;
        }

        // If unique context mode is enabled, always select first context
        if (uniqueContextMode) {
            const firstContext = contexts[0].name;
            console.log('[CONTEXTS] Unique context mode - selecting first context:', firstContext);
            this.selectContext(firstContext);
            return firstContext;
        }

        const lastContext = localStorage.getItem('lastContext');
        console.log('[CONTEXTS] lastContext from localStorage:', lastContext);

        // Try to restore last used context
        if (lastContext) {
            const contextExists = contexts.some(c => c.name === lastContext);
            console.log('[CONTEXTS] lastContext exists?', contextExists);
            if (contextExists) {
                console.log('[CONTEXTS] Selecting last context:', lastContext);
                this.selectContext(lastContext);
                return lastContext;
            }
        }

        // If no last context or it doesn't exist, select first context
        const firstContext = contexts[0].name;
        console.log('[CONTEXTS] Selecting first context:', firstContext);
        this.selectContext(firstContext);
        return firstContext;
    }
}

export const contexts = new ContextsManager();
