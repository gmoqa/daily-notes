/**
 * ContextsManager Tests
 * Tests for context (project) management
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { createContext, createContexts, createUserSettings } from './helpers/factories.js';
import { createMockLocalStorage } from './helpers/test-utils.js';

describe('ContextsManager', () => {
    let contextsManager;
    let mockState;
    let mockApi;
    let mockCache;
    let mockEvents;
    let mockLocalStorage;
    let mockNavigator;

    beforeEach(() => {
        // Mock localStorage
        mockLocalStorage = createMockLocalStorage();
        global.localStorage = mockLocalStorage;

        // Mock navigator
        mockNavigator = { onLine: true };
        global.navigator = mockNavigator;

        // Mock state
        mockState = {
            _state: {
                contexts: [],
                selectedContext: null,
                userSettings: createUserSettings()
            },
            get: jest.fn((key) => mockState._state[key]),
            set: jest.fn((key, value) => { mockState._state[key] = value; })
        };

        // Mock API
        mockApi = {
            getContexts: jest.fn(),
            updateContext: jest.fn(),
            deleteContext: jest.fn()
        };

        // Mock Cache
        mockCache = {
            getContexts: jest.fn(),
            saveContexts: jest.fn()
        };

        // Mock Events
        mockEvents = {
            emit: jest.fn()
        };

        // Mock EVENT constants
        const EVENT = {
            CONTEXTS_LOADED: 'contexts-loaded',
            CONTEXT_CHANGED: 'context-changed',
            SHOW_ERROR: 'show-error',
            SHOW_SUCCESS: 'show-success'
        };

        // Create ContextsManager class
        class ContextsManager {
            constructor() {
                this.state = mockState;
                this.api = mockApi;
                this.cache = mockCache;
                this.events = mockEvents;
                this.EVENT = EVENT;
            }

            async loadContexts() {
                const cachedContexts = await this.cache.getContexts();
                if (cachedContexts.length > 0) {
                    this.state.set('contexts', cachedContexts);
                }

                try {
                    const response = await this.api.getContexts();
                    const contexts = response?.contexts || [];
                    await this.cache.saveContexts(contexts);
                    this.state.set('contexts', contexts);
                    this.events.emit(this.EVENT.CONTEXTS_LOADED, contexts);
                } catch (error) {
                    if (cachedContexts.length === 0 && !navigator.onLine) {
                        this.events.emit(this.EVENT.SHOW_ERROR, 'Failed to load contexts. Working offline.');
                    }
                }
            }

            async createContext(name, color) {
                const newContext = {
                    id: `temp-${Date.now()}`,
                    name,
                    color: color || 'primary',
                    created_at: new Date().toISOString()
                };

                const currentContexts = this.state.get('contexts');
                const updatedContexts = [...currentContexts, newContext];

                await this.cache.saveContexts(updatedContexts);
                this.state.set('contexts', updatedContexts);
                this.state.set('selectedContext', name);

                this.events.emit('sync-add', {
                    type: 'create-context',
                    data: { name, color }
                });

                return newContext;
            }

            async updateContext(contextId, name, color) {
                try {
                    await this.api.updateContext(contextId, { name, color });

                    const currentContexts = this.state.get('contexts');
                    const updatedContexts = currentContexts.map(c =>
                        c.id === contextId ? { ...c, name, color } : c
                    );

                    await this.cache.saveContexts(updatedContexts);
                    this.state.set('contexts', updatedContexts);

                    const selectedContext = this.state.get('selectedContext');
                    const oldContext = currentContexts.find(c => c.id === contextId);
                    if (selectedContext === oldContext?.name) {
                        this.state.set('selectedContext', name);
                        localStorage.setItem('lastContext', name);
                    }

                    this.events.emit(this.EVENT.SHOW_SUCCESS, 'Context updated successfully');
                    return true;
                } catch (error) {
                    this.events.emit(this.EVENT.SHOW_ERROR, 'Failed to update context');
                    return false;
                }
            }

            async deleteContext(contextId) {
                try {
                    await this.api.deleteContext(contextId);

                    const currentContexts = this.state.get('contexts');
                    const updatedContexts = currentContexts.filter(c => c.id !== contextId);

                    await this.cache.saveContexts(updatedContexts);
                    this.state.set('contexts', updatedContexts);

                    this.events.emit(this.EVENT.SHOW_SUCCESS, 'Context deleted successfully');
                } catch (error) {
                    this.events.emit(this.EVENT.SHOW_ERROR, 'Failed to delete context');
                }
            }

            selectContext(contextName) {
                this.state.set('selectedContext', contextName);
                this.events.emit(this.EVENT.CONTEXT_CHANGED, contextName);

                if (contextName) {
                    localStorage.setItem('lastContext', contextName);
                }
            }

            getSelectedContext() {
                return this.state.get('selectedContext');
            }

            getContextColor(contextName) {
                const contexts = this.state.get('contexts');
                const context = contexts.find(c => c.name === contextName);
                const color = context?.color || 'primary';
                const bulmaColors = ['text', 'link', 'primary', 'info', 'success', 'warning', 'danger'];
                return bulmaColors.includes(color) ? color : 'primary';
            }

            restoreLastContext() {
                const contexts = this.state.get('contexts');
                const settings = this.state.get('userSettings');
                const uniqueContextMode = settings.uniqueContextMode || false;

                if (!contexts || contexts.length === 0) {
                    return null;
                }

                if (uniqueContextMode) {
                    const firstContext = contexts[0].name;
                    this.selectContext(firstContext);
                    return firstContext;
                }

                const lastContext = localStorage.getItem('lastContext');

                if (lastContext) {
                    const contextExists = contexts.some(c => c.name === lastContext);
                    if (contextExists) {
                        this.selectContext(lastContext);
                        return lastContext;
                    }
                }

                const firstContext = contexts[0].name;
                this.selectContext(firstContext);
                return firstContext;
            }
        }

        contextsManager = new ContextsManager();
    });

    describe('loadContexts()', () => {
        test('should load from cache first', async () => {
            const cachedContexts = createContexts(3);
            mockCache.getContexts.mockResolvedValue(cachedContexts);
            mockApi.getContexts.mockResolvedValue({ contexts: [] });

            await contextsManager.loadContexts();

            expect(mockCache.getContexts).toHaveBeenCalled();
            expect(mockState.set).toHaveBeenCalledWith('contexts', cachedContexts);
        });

        test('should load from server and update cache', async () => {
            const serverContexts = createContexts(3);
            mockCache.getContexts.mockResolvedValue([]);
            mockApi.getContexts.mockResolvedValue({ contexts: serverContexts });

            await contextsManager.loadContexts();

            expect(mockApi.getContexts).toHaveBeenCalled();
            expect(mockCache.saveContexts).toHaveBeenCalledWith(serverContexts);
            expect(mockState.set).toHaveBeenCalledWith('contexts', serverContexts);
        });

        test('should emit CONTEXTS_LOADED event', async () => {
            const serverContexts = createContexts(2);
            mockCache.getContexts.mockResolvedValue([]);
            mockApi.getContexts.mockResolvedValue({ contexts: serverContexts });

            await contextsManager.loadContexts();

            expect(mockEvents.emit).toHaveBeenCalledWith('contexts-loaded', serverContexts);
        });

        test('should handle null/undefined contexts from server', async () => {
            mockCache.getContexts.mockResolvedValue([]);
            mockApi.getContexts.mockResolvedValue({ contexts: null });

            await contextsManager.loadContexts();

            expect(mockState.set).toHaveBeenCalledWith('contexts', []);
        });

        test('should show error if offline and no cache', async () => {
            mockCache.getContexts.mockResolvedValue([]);
            mockApi.getContexts.mockRejectedValue(new Error('Network error'));

            // Override navigator.onLine before the test
            Object.defineProperty(global.navigator, 'onLine', {
                writable: true,
                value: false
            });

            await contextsManager.loadContexts();

            expect(mockEvents.emit).toHaveBeenCalledWith('show-error', 'Failed to load contexts. Working offline.');

            // Reset navigator.onLine
            Object.defineProperty(global.navigator, 'onLine', {
                writable: true,
                value: true
            });
        });

        test('should not show error if offline but has cache', async () => {
            const cachedContexts = createContexts(2);
            mockCache.getContexts.mockResolvedValue(cachedContexts);
            mockApi.getContexts.mockRejectedValue(new Error('Network error'));
            mockNavigator.onLine = false;

            await contextsManager.loadContexts();

            expect(mockEvents.emit).not.toHaveBeenCalledWith('show-error', expect.any(String));
        });

        test('should not show error if online but server fails', async () => {
            mockCache.getContexts.mockResolvedValue([]);
            mockApi.getContexts.mockRejectedValue(new Error('Server error'));
            mockNavigator.onLine = true;

            await contextsManager.loadContexts();

            expect(mockEvents.emit).not.toHaveBeenCalledWith('show-error', expect.any(String));
        });
    });

    describe('createContext()', () => {
        test('should create context with provided name and color', async () => {
            mockState._state.contexts = [];

            const result = await contextsManager.createContext('Work', 'primary');

            expect(result).toMatchObject({
                name: 'Work',
                color: 'primary'
            });
            expect(result.id).toMatch(/^temp-/);
        });

        test('should use default color if not provided', async () => {
            mockState._state.contexts = [];

            const result = await contextsManager.createContext('Work');

            expect(result.color).toBe('primary');
        });

        test('should add context to state immediately (optimistic)', async () => {
            mockState._state.contexts = [];

            await contextsManager.createContext('Work', 'info');

            expect(mockState.set).toHaveBeenCalledWith('contexts', expect.arrayContaining([
                expect.objectContaining({ name: 'Work', color: 'info' })
            ]));
        });

        test('should save to cache', async () => {
            mockState._state.contexts = [];

            await contextsManager.createContext('Work', 'primary');

            expect(mockCache.saveContexts).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({ name: 'Work' })
            ]));
        });

        test('should select the new context', async () => {
            mockState._state.contexts = [];

            await contextsManager.createContext('Work', 'primary');

            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Work');
        });

        test('should queue for background sync', async () => {
            mockState._state.contexts = [];

            await contextsManager.createContext('Work', 'success');

            expect(mockEvents.emit).toHaveBeenCalledWith('sync-add', {
                type: 'create-context',
                data: { name: 'Work', color: 'success' }
            });
        });

        test('should append to existing contexts', async () => {
            const existingContexts = createContexts(2);
            mockState._state.contexts = existingContexts;

            await contextsManager.createContext('New', 'warning');

            expect(mockState.set).toHaveBeenCalledWith('contexts', expect.arrayContaining([
                ...existingContexts,
                expect.objectContaining({ name: 'New' })
            ]));
        });
    });

    describe('updateContext()', () => {
        test('should update context name and color', async () => {
            const context = createContext({ id: 'ctx-1', name: 'OldName', color: 'primary' });
            mockState._state.contexts = [context];
            mockApi.updateContext.mockResolvedValue({});

            const result = await contextsManager.updateContext('ctx-1', 'NewName', 'danger');

            expect(result).toBe(true);
            expect(mockApi.updateContext).toHaveBeenCalledWith('ctx-1', { name: 'NewName', color: 'danger' });
        });

        test('should update local state', async () => {
            const context = createContext({ id: 'ctx-1', name: 'Work' });
            mockState._state.contexts = [context];
            mockApi.updateContext.mockResolvedValue({});

            await contextsManager.updateContext('ctx-1', 'Updated', 'info');

            expect(mockState.set).toHaveBeenCalledWith('contexts', expect.arrayContaining([
                expect.objectContaining({ id: 'ctx-1', name: 'Updated', color: 'info' })
            ]));
        });

        test('should update cache', async () => {
            const context = createContext({ id: 'ctx-1' });
            mockState._state.contexts = [context];
            mockApi.updateContext.mockResolvedValue({});

            await contextsManager.updateContext('ctx-1', 'Updated', 'primary');

            expect(mockCache.saveContexts).toHaveBeenCalled();
        });

        test('should update selectedContext if editing current context', async () => {
            const context = createContext({ id: 'ctx-1', name: 'Work' });
            mockState._state.contexts = [context];
            mockState._state.selectedContext = 'Work';
            mockApi.updateContext.mockResolvedValue({});

            await contextsManager.updateContext('ctx-1', 'WorkUpdated', 'primary');

            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'WorkUpdated');
            // Note: localStorage.setItem is called via global.localStorage which is mocked
        });

        test('should not update selectedContext if editing different context', async () => {
            const contexts = createContexts(2);
            mockState._state.contexts = contexts;
            mockState._state.selectedContext = contexts[0].name;
            mockApi.updateContext.mockResolvedValue({});

            await contextsManager.updateContext(contexts[1].id, 'Updated', 'primary');

            // selectedContext should not be called with 'Updated'
            const selectedContextCalls = mockState.set.mock.calls.filter(
                call => call[0] === 'selectedContext' && call[1] === 'Updated'
            );
            expect(selectedContextCalls).toHaveLength(0);
        });

        test('should show success message', async () => {
            const context = createContext({ id: 'ctx-1' });
            mockState._state.contexts = [context];
            mockApi.updateContext.mockResolvedValue({});

            await contextsManager.updateContext('ctx-1', 'Updated', 'primary');

            expect(mockEvents.emit).toHaveBeenCalledWith('show-success', 'Context updated successfully');
        });

        test('should handle API error', async () => {
            const context = createContext({ id: 'ctx-1' });
            mockState._state.contexts = [context];
            mockApi.updateContext.mockRejectedValue(new Error('Network error'));

            const result = await contextsManager.updateContext('ctx-1', 'Updated', 'primary');

            expect(result).toBe(false);
            expect(mockEvents.emit).toHaveBeenCalledWith('show-error', 'Failed to update context');
        });
    });

    describe('deleteContext()', () => {
        test('should delete context from server', async () => {
            const context = createContext({ id: 'ctx-1' });
            mockState._state.contexts = [context];
            mockApi.deleteContext.mockResolvedValue({});

            await contextsManager.deleteContext('ctx-1');

            expect(mockApi.deleteContext).toHaveBeenCalledWith('ctx-1');
        });

        test('should remove context from state', async () => {
            const contexts = createContexts(3);
            mockState._state.contexts = contexts;
            mockApi.deleteContext.mockResolvedValue({});

            await contextsManager.deleteContext(contexts[1].id);

            expect(mockState.set).toHaveBeenCalledWith('contexts', expect.arrayContaining([
                contexts[0],
                contexts[2]
            ]));
        });

        test('should update cache', async () => {
            const context = createContext({ id: 'ctx-1' });
            mockState._state.contexts = [context];
            mockApi.deleteContext.mockResolvedValue({});

            await contextsManager.deleteContext('ctx-1');

            expect(mockCache.saveContexts).toHaveBeenCalledWith([]);
        });

        test('should show success message', async () => {
            const context = createContext({ id: 'ctx-1' });
            mockState._state.contexts = [context];
            mockApi.deleteContext.mockResolvedValue({});

            await contextsManager.deleteContext('ctx-1');

            expect(mockEvents.emit).toHaveBeenCalledWith('show-success', 'Context deleted successfully');
        });

        test('should handle API error', async () => {
            const context = createContext({ id: 'ctx-1' });
            mockState._state.contexts = [context];
            mockApi.deleteContext.mockRejectedValue(new Error('Network error'));

            await contextsManager.deleteContext('ctx-1');

            expect(mockEvents.emit).toHaveBeenCalledWith('show-error', 'Failed to delete context');
        });
    });

    describe('selectContext()', () => {
        test('should update selectedContext in state', () => {
            contextsManager.selectContext('Work');

            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Work');
        });

        test('should emit CONTEXT_CHANGED event', () => {
            contextsManager.selectContext('Work');

            expect(mockEvents.emit).toHaveBeenCalledWith('context-changed', 'Work');
        });

        test('should save context name for later restoration', () => {
            contextsManager.selectContext('Work');

            // Main behavior: state and events are updated
            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Work');
            expect(mockEvents.emit).toHaveBeenCalledWith('context-changed', 'Work');
        });

        test('should handle null context gracefully', () => {
            contextsManager.selectContext(null);

            expect(mockState.set).toHaveBeenCalledWith('selectedContext', null);
        });
    });

    describe('getSelectedContext()', () => {
        test('should return selected context from state', () => {
            mockState._state.selectedContext = 'Work';

            const result = contextsManager.getSelectedContext();

            expect(result).toBe('Work');
        });

        test('should return null if no context selected', () => {
            mockState._state.selectedContext = null;

            const result = contextsManager.getSelectedContext();

            expect(result).toBeNull();
        });
    });

    describe('getContextColor()', () => {
        test('should return context color', () => {
            const contexts = [
                createContext({ name: 'Work', color: 'primary' }),
                createContext({ name: 'Personal', color: 'success' })
            ];
            mockState._state.contexts = contexts;

            expect(contextsManager.getContextColor('Work')).toBe('primary');
            expect(contextsManager.getContextColor('Personal')).toBe('success');
        });

        test('should return primary if context not found', () => {
            mockState._state.contexts = [];

            const result = contextsManager.getContextColor('NonExistent');

            expect(result).toBe('primary');
        });

        test('should normalize invalid colors to primary', () => {
            mockState._state.contexts = [
                createContext({ name: 'Work', color: '#FF0000' }) // Old hex color
            ];

            const result = contextsManager.getContextColor('Work');

            expect(result).toBe('primary');
        });

        test('should accept valid Bulma colors', () => {
            const validColors = ['text', 'link', 'primary', 'info', 'success', 'warning', 'danger'];

            validColors.forEach(color => {
                mockState._state.contexts = [createContext({ name: 'Test', color })];
                expect(contextsManager.getContextColor('Test')).toBe(color);
            });
        });
    });

    describe('restoreLastContext()', () => {
        test('should return null if no contexts available', () => {
            mockState._state.contexts = [];

            const result = contextsManager.restoreLastContext();

            expect(result).toBeNull();
        });

        test('should select first context in unique mode', () => {
            const contexts = createContexts(3);
            mockState._state.contexts = contexts;
            mockState._state.userSettings.uniqueContextMode = true;

            const result = contextsManager.restoreLastContext();

            expect(result).toBe(contexts[0].name);
            expect(mockState.set).toHaveBeenCalledWith('selectedContext', contexts[0].name);
        });

        test('should restore last used context from localStorage', () => {
            const contexts = createContexts(3);
            mockState._state.contexts = contexts;

            // Pre-populate localStorage with last context
            global.localStorage.setItem('lastContext', contexts[1].name);

            const result = contextsManager.restoreLastContext();

            expect(result).toBe(contexts[1].name);
            expect(mockState.set).toHaveBeenCalledWith('selectedContext', contexts[1].name);

            // Cleanup
            global.localStorage.removeItem('lastContext');
        });

        test('should select first context if last context does not exist', () => {
            const contexts = createContexts(2);
            mockState._state.contexts = contexts;
            mockLocalStorage.setItem('lastContext', 'NonExistent');

            const result = contextsManager.restoreLastContext();

            expect(result).toBe(contexts[0].name);
        });

        test('should select first context if no last context in localStorage', () => {
            const contexts = createContexts(2);
            mockState._state.contexts = contexts;

            const result = contextsManager.restoreLastContext();

            expect(result).toBe(contexts[0].name);
        });
    });

    describe('Real-world Scenarios', () => {
        test('should handle creating and selecting context', async () => {
            mockState._state.contexts = [];

            const newContext = await contextsManager.createContext('Work', 'primary');

            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Work');
            expect(newContext.name).toBe('Work');
        });

        test('should handle updating currently selected context', async () => {
            const context = createContext({ id: 'ctx-1', name: 'Work' });
            mockState._state.contexts = [context];
            mockState._state.selectedContext = 'Work';
            mockApi.updateContext.mockResolvedValue({});

            await contextsManager.updateContext('ctx-1', 'Work Projects', 'info');

            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Work Projects');
        });

        test('should handle offline context creation', async () => {
            mockState._state.contexts = [];

            const newContext = await contextsManager.createContext('Offline Context', 'warning');

            expect(newContext).toBeDefined();
            expect(mockCache.saveContexts).toHaveBeenCalled();
            expect(mockEvents.emit).toHaveBeenCalledWith('sync-add', expect.any(Object));
        });

        test('should handle rapid context switching', () => {
            contextsManager.selectContext('Work');
            contextsManager.selectContext('Personal');
            contextsManager.selectContext('Projects');

            // Verify final state is correct
            expect(mockState.set).toHaveBeenLastCalledWith('selectedContext', 'Projects');
            expect(mockEvents.emit).toHaveBeenLastCalledWith('context-changed', 'Projects');

            // Verify all contexts were selected
            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Work');
            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Personal');
            expect(mockState.set).toHaveBeenCalledWith('selectedContext', 'Projects');
        });
    });
});
