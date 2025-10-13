/**
 * API Client Module
 * Handles all backend communication
 */

import { state } from './state.js';
import { events, EVENT } from './events.js';

class APIClient {
    constructor() {
        this.baseUrl = '';
    }

    async request(endpoint, options = {}) {
        try {
            const response = await fetch(endpoint, {
                ...options,
                headers: {
                    ...options.headers,
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin'
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));

                if (response.status === 401) {
                    if (!state.get('isLoggingOut')) {
                        events.emit(EVENT.SHOW_ERROR, 'Session expired. Please login again.');
                    }
                    state.set('currentUser', null);
                    return;
                }

                throw new Error(data.error || `Request failed with status ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (!state.get('isLoggingOut')) {
                events.emit(EVENT.SHOW_ERROR, error.message || 'An error occurred');
            }
            throw error;
        }
    }

    // Auth endpoints
    async checkAuth() {
        try {
            const response = await fetch('/api/auth/me');
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Auth check failed:', error);
            return { authenticated: false };
        }
    }

    async login(accessToken, expiresIn) {
        return await this.request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                access_token: accessToken,
                expires_in: expiresIn || 3600
            })
        });
    }

    async logout() {
        return await this.request('/api/auth/logout', {
            method: 'POST'
        });
    }

    // Contexts endpoints
    async getContexts() {
        return await this.request('/api/contexts');
    }

    async createContext(data) {
        return await this.request('/api/contexts', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async deleteContext(id) {
        return await this.request(`/api/contexts/${id}`, {
            method: 'DELETE'
        });
    }

    // Notes endpoints
    async getNote(context, date) {
        return await this.request(
            `/api/notes?context=${encodeURIComponent(context)}&date=${date}`
        );
    }

    async saveNote(data) {
        return await this.request('/api/notes', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getNotesList(context, limit = 50, offset = 0) {
        return await this.request(
            `/api/notes/list?context=${encodeURIComponent(context)}&limit=${limit}&offset=${offset}`
        );
    }

    async deleteNote(id) {
        return await this.request(`/api/notes/${id}`, {
            method: 'DELETE'
        });
    }

    // Settings endpoints
    async updateSettings(settings) {
        return await this.request('/api/settings', {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
    }

    // Time sync
    async getServerTime(timezone) {
        const response = await fetch(`/api/time?timezone=${encodeURIComponent(timezone)}`);
        return await response.json();
    }
}

export const api = new APIClient();
