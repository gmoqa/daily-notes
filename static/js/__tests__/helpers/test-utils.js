/**
 * Test Utilities
 * Reusable helpers for testing
 */

import { jest } from '@jest/globals';

/**
 * Create a mock IndexedDB
 */
export function createMockIndexedDB() {
    const stores = new Map();

    class MockObjectStore {
        constructor(name, data = new Map()) {
            this.name = name;
            this.data = data;
        }

        put(value) {
            const key = value.id || `${value.context}-${value.date}`;
            this.data.set(key, value);
            return { onsuccess: null, onerror: null };
        }

        get(key) {
            const request = {
                result: this.data.get(key) || null,
                onsuccess: null,
                onerror: null
            };
            setTimeout(() => request.onsuccess?.(), 0);
            return request;
        }

        getAll() {
            const request = {
                result: Array.from(this.data.values()),
                onsuccess: null,
                onerror: null
            };
            setTimeout(() => request.onsuccess?.(), 0);
            return request;
        }

        clear() {
            this.data.clear();
            return { onsuccess: null, onerror: null };
        }
    }

    class MockTransaction {
        constructor(storeNames) {
            this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
            this.oncomplete = null;
            this.onerror = null;
            setTimeout(() => this.oncomplete?.(), 0);
        }

        objectStore(name) {
            if (!stores.has(name)) {
                stores.set(name, new MockObjectStore(name));
            }
            return stores.get(name);
        }
    }

    class MockDatabase {
        transaction(storeNames, mode) {
            return new MockTransaction(storeNames);
        }

        get objectStoreNames() {
            return { contains: (name) => stores.has(name) };
        }

        createObjectStore(name, options) {
            const store = new MockObjectStore(name);
            stores.set(name, store);
            return store;
        }
    }

    class MockIDBOpenRequest {
        constructor() {
            this.onsuccess = null;
            this.onerror = null;
            this.onupgradeneeded = null;
            this.result = new MockDatabase();

            // Simulate async open
            setTimeout(() => {
                if (this.onupgradeneeded) {
                    this.onupgradeneeded({
                        target: { result: this.result }
                    });
                }
                this.onsuccess?.();
            }, 0);
        }
    }

    return {
        open: (name, version) => new MockIDBOpenRequest(),
        stores,
        clearAllStores: () => stores.clear()
    };
}

/**
 * Create mock fetch
 */
export function createMockFetch(responses = {}) {
    return async (url, options = {}) => {
        const key = `${options.method || 'GET'} ${url}`;
        const response = responses[key] || responses[url];

        if (!response) {
            throw new Error(`No mock response for: ${key}`);
        }

        if (response instanceof Error) {
            throw response;
        }

        return {
            ok: response.ok !== false,
            status: response.status || 200,
            json: async () => response.data || response,
            text: async () => JSON.stringify(response.data || response)
        };
    };
}

/**
 * Create mock localStorage
 */
export function createMockLocalStorage() {
    const storage = new Map();

    const mock = {
        getItem: jest.fn((key) => storage.get(key) || null),
        setItem: jest.fn((key, value) => storage.set(key, value)),
        removeItem: jest.fn((key) => storage.delete(key)),
        clear: jest.fn(() => storage.clear()),
        get length() { return storage.size; },
        key: jest.fn((index) => Array.from(storage.keys())[index] || null)
    };

    return mock;
}

/**
 * Wait for async operations
 */
export function waitFor(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for condition to be true
 */
export async function waitForCondition(condition, timeout = 1000) {
    const startTime = Date.now();
    while (!condition()) {
        if (Date.now() - startTime > timeout) {
            throw new Error('Timeout waiting for condition');
        }
        await waitFor(10);
    }
}

/**
 * Create spy function
 */
export function createSpy(implementation) {
    const calls = [];
    const spy = (...args) => {
        calls.push(args);
        return implementation?.(...args);
    };
    spy.calls = calls;
    spy.callCount = () => calls.length;
    spy.calledWith = (...args) => calls.some(
        call => JSON.stringify(call) === JSON.stringify(args)
    );
    spy.reset = () => { calls.length = 0; };
    return spy;
}

/**
 * Mock DOM element
 */
export function createMockElement(tagName = 'div', properties = {}) {
    const element = {
        tagName: tagName.toUpperCase(),
        ...properties,
        addEventListener: createSpy(),
        removeEventListener: createSpy(),
        querySelector: () => null,
        querySelectorAll: () => [],
        setAttribute: createSpy(),
        getAttribute: () => null,
        classList: {
            add: createSpy(),
            remove: createSpy(),
            toggle: createSpy(),
            contains: () => false
        }
    };
    return element;
}
