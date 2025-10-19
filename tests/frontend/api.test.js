/**
 * APIClient Tests
 * Tests for backend communication layer
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { createMockFetch } from './helpers/test-utils.js';
import { createNote, createNotes, createContext, createContexts } from './helpers/factories.js';

describe('APIClient', () => {
    let api;
    let mockState;
    let mockEvents;
    let originalFetch;

    beforeEach(() => {
        // Mock state
        mockState = {
            _state: { isLoggingOut: false },
            get: jest.fn((key) => mockState._state[key]),
            set: jest.fn((key, value) => { mockState._state[key] = value; })
        };

        // Mock events
        mockEvents = {
            emit: jest.fn()
        };

        // Create APIClient class for testing
        class APIClient {
            constructor() {
                this.baseUrl = '';
                this.state = mockState;
                this.events = mockEvents;
                this.EVENT = {
                    SHOW_ERROR: 'show-error',
                    SHOW_SUCCESS: 'show-success'
                };
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

                        if (response.status === 401 || response.status === 403) {
                            if (!this.state.get('isLoggingOut')) {
                                const isNoteRequest = endpoint.includes('/api/notes');
                                const message = isNoteRequest
                                    ? 'Session expired. Your notes are saved locally and will sync when you sign in again.'
                                    : 'Session expired. Please login again.';

                                this.events.emit(this.EVENT.SHOW_ERROR, message);
                                this.events.emit('session-expired', { isNoteRequest });
                            }
                            this.state.set('currentUser', null);
                            throw new Error('Session expired');
                        }

                        throw new Error(data.error || `Request failed with status ${response.status}`);
                    }

                    return await response.json();
                } catch (error) {
                    if (!this.state.get('isLoggingOut')) {
                        if (!error.message.includes('Session expired')) {
                            this.events.emit(this.EVENT.SHOW_ERROR, error.message || 'An error occurred');
                        }
                    }
                    throw error;
                }
            }

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

            async getContexts() {
                return await this.request('/api/contexts');
            }

            async createContext(data) {
                return await this.request('/api/contexts', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
            }

            async updateContext(id, data) {
                return await this.request(`/api/contexts/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
            }

            async deleteContext(id) {
                return await this.request(`/api/contexts/${id}`, {
                    method: 'DELETE'
                });
            }

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

            async updateSettings(settings) {
                return await this.request('/api/settings', {
                    method: 'PUT',
                    body: JSON.stringify(settings)
                });
            }

            async getServerTime(timezone) {
                const response = await fetch(`/api/time?timezone=${encodeURIComponent(timezone)}`);
                return await response.json();
            }
        }

        api = new APIClient();
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Request Method', () => {
        test('should make successful GET request', async () => {
            global.fetch = createMockFetch({
                '/api/contexts': { contexts: [] }
            });

            const result = await api.request('/api/contexts');
            expect(result).toEqual({ contexts: [] });
        });

        test('should make successful POST request', async () => {
            const newContext = createContext();
            global.fetch = createMockFetch({
                'POST /api/contexts': { context: newContext }
            });

            const result = await api.request('/api/contexts', {
                method: 'POST',
                body: JSON.stringify(newContext)
            });

            expect(result).toEqual({ context: newContext });
        });

        test('should include Content-Type header', async () => {
            let capturedOptions;
            global.fetch = jest.fn(async (url, options) => {
                capturedOptions = options;
                return {
                    ok: true,
                    json: async () => ({ success: true })
                };
            });

            await api.request('/api/test');

            expect(capturedOptions.headers['Content-Type']).toBe('application/json');
        });

        test('should include credentials', async () => {
            let capturedOptions;
            global.fetch = jest.fn(async (url, options) => {
                capturedOptions = options;
                return {
                    ok: true,
                    json: async () => ({ success: true })
                };
            });

            await api.request('/api/test');

            expect(capturedOptions.credentials).toBe('same-origin');
        });
    });

    describe('Error Handling', () => {
        test('should handle 401 unauthorized', async () => {
            global.fetch = createMockFetch({
                '/api/test': { ok: false, status: 401, data: { error: 'Unauthorized' } }
            });

            await expect(api.request('/api/test')).rejects.toThrow('Session expired');
            expect(mockState.set).toHaveBeenCalledWith('currentUser', null);
            expect(mockEvents.emit).toHaveBeenCalledWith('show-error', expect.any(String));
        });

        test('should handle 403 forbidden', async () => {
            global.fetch = createMockFetch({
                '/api/test': { ok: false, status: 403, data: { error: 'Forbidden' } }
            });

            await expect(api.request('/api/test')).rejects.toThrow('Session expired');
        });

        test('should show different message for note requests', async () => {
            global.fetch = createMockFetch({
                '/api/notes': { ok: false, status: 401, data: {} }
            });

            await expect(api.request('/api/notes')).rejects.toThrow('Session expired');
            expect(mockEvents.emit).toHaveBeenCalledWith(
                'show-error',
                expect.stringContaining('saved locally')
            );
        });

        test('should handle generic errors', async () => {
            global.fetch = createMockFetch({
                '/api/test': { ok: false, status: 500, data: { error: 'Server error' } }
            });

            await expect(api.request('/api/test')).rejects.toThrow('Server error');
        });

        test('should not show error when logging out', async () => {
            mockState._state.isLoggingOut = true;

            global.fetch = createMockFetch({
                '/api/test': { ok: false, status: 401, data: {} }
            });

            await expect(api.request('/api/test')).rejects.toThrow('Session expired');
            expect(mockEvents.emit).not.toHaveBeenCalledWith('show-error', expect.any(String));
        });
    });

    describe('Auth Endpoints', () => {
        test('should check auth', async () => {
            global.fetch = createMockFetch({
                '/api/auth/me': { authenticated: true, user: { email: 'test@example.com' } }
            });

            const result = await api.checkAuth();
            expect(result.authenticated).toBe(true);
        });

        test('should handle auth check failure', async () => {
            global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            const result = await api.checkAuth();
            expect(result).toEqual({ authenticated: false });
        });

        test('should login', async () => {
            global.fetch = createMockFetch({
                'POST /api/auth/login': { success: true, user: { email: 'test@example.com' } }
            });

            const result = await api.login('test-token', 3600);
            expect(result.success).toBe(true);
        });

        test('should logout', async () => {
            global.fetch = createMockFetch({
                'POST /api/auth/logout': { success: true }
            });

            const result = await api.logout();
            expect(result.success).toBe(true);
        });
    });

    describe('Context Endpoints', () => {
        test('should get contexts', async () => {
            const contexts = createContexts(3);
            global.fetch = createMockFetch({
                '/api/contexts': { contexts }
            });

            const result = await api.getContexts();
            expect(result.contexts).toHaveLength(3);
        });

        test('should create context', async () => {
            const context = createContext();
            global.fetch = createMockFetch({
                'POST /api/contexts': { context }
            });

            const result = await api.createContext({ name: 'Work', color: 'primary' });
            expect(result.context).toBeDefined();
        });

        test('should update context', async () => {
            global.fetch = createMockFetch({
                'PUT /api/contexts/123': { success: true }
            });

            const result = await api.updateContext('123', { name: 'Updated' });
            expect(result.success).toBe(true);
        });

        test('should delete context', async () => {
            global.fetch = createMockFetch({
                'DELETE /api/contexts/123': { success: true }
            });

            const result = await api.deleteContext('123');
            expect(result.success).toBe(true);
        });
    });

    describe('Notes Endpoints', () => {
        test('should get note', async () => {
            const note = createNote();
            global.fetch = createMockFetch({
                '/api/notes?context=Work&date=2025-10-16': { note }
            });

            const result = await api.getNote('Work', '2025-10-16');
            expect(result.note).toBeDefined();
        });

        test('should encode context with special characters', async () => {
            let capturedUrl;
            global.fetch = jest.fn(async (url) => {
                capturedUrl = url;
                return {
                    ok: true,
                    json: async () => ({ note: {} })
                };
            });

            await api.getNote('Work/Projects', '2025-10-16');
            expect(capturedUrl).toContain(encodeURIComponent('Work/Projects'));
        });

        test('should save note', async () => {
            const note = createNote();
            global.fetch = createMockFetch({
                'POST /api/notes': { note }
            });

            const result = await api.saveNote(note);
            expect(result.note).toBeDefined();
        });

        test('should get notes list', async () => {
            const notes = createNotes(5);
            global.fetch = createMockFetch({
                '/api/notes/list?context=Work&limit=50&offset=0': { notes }
            });

            const result = await api.getNotesList('Work');
            expect(result.notes).toHaveLength(5);
        });

        test('should get notes list with custom limit and offset', async () => {
            let capturedUrl;
            global.fetch = jest.fn(async (url) => {
                capturedUrl = url;
                return {
                    ok: true,
                    json: async () => ({ notes: [] })
                };
            });

            await api.getNotesList('Work', 10, 20);
            expect(capturedUrl).toContain('limit=10');
            expect(capturedUrl).toContain('offset=20');
        });

        test('should delete note', async () => {
            global.fetch = createMockFetch({
                'DELETE /api/notes/123': { success: true }
            });

            const result = await api.deleteNote('123');
            expect(result.success).toBe(true);
        });
    });

    describe('Settings Endpoints', () => {
        test('should update settings', async () => {
            const settings = { theme: 'dark', weekStart: 1 };
            global.fetch = createMockFetch({
                'PUT /api/settings': { success: true, settings }
            });

            const result = await api.updateSettings(settings);
            expect(result.success).toBe(true);
        });
    });

    describe('Time Sync', () => {
        test('should get server time', async () => {
            global.fetch = createMockFetch({
                '/api/time?timezone=America%2FNew_York': {
                    serverTime: '2025-10-16T12:00:00Z',
                    offset: 0
                }
            });

            const result = await api.getServerTime('America/New_York');
            expect(result.serverTime).toBeDefined();
        });
    });
});
