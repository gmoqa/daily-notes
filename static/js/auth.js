/**
 * Authentication Module
 * Handles Google OAuth and session management
 */

import { state } from './state.js';
import { api } from './api.js';
import { events, EVENT } from './events.js';

class AuthManager {
    constructor() {
        this.codeClient = null;
        this.initializationPromise = null;
    }

    async checkAuth() {
        const data = await api.checkAuth();

        if (data.authenticated) {
            state.update({
                currentUser: data.user,
                userSettings: data.user.settings || {
                    theme: 'dark',
                    weekStart: 0,
                    timezone: 'UTC',
                    dateFormat: 'DD-MM-YY',
                    showBreadcrumb: false,
                    showMarkdownEditor: false
                }
            });
            return true;
        }

        return false;
    }

    async initGoogleClient(clientId) {
        // Return existing initialization promise if already in progress
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        // Return immediately if already initialized
        if (this.codeClient) {
            return Promise.resolve();
        }

        // Create initialization promise
        this.initializationPromise = new Promise((resolve, reject) => {
            // Wait for Google API to be loaded
            const checkGoogleLoaded = () => {
                if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
                    try {
                        // Use initCodeClient to get authorization code (which provides refresh token)
                        this.codeClient = google.accounts.oauth2.initCodeClient({
                            client_id: clientId,
                            scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
                            ux_mode: 'popup',
                            callback: (response) => this.handleAuthCodeResponse(response)
                        });
                        console.log('[AUTH] Google code client initialized successfully');
                        resolve();
                    } catch (error) {
                        console.error('[AUTH] Failed to initialize Google client:', error);
                        reject(error);
                    }
                } else {
                    // Retry after a short delay
                    setTimeout(checkGoogleLoaded, 100);
                }
            };

            // Start checking
            checkGoogleLoaded();

            // Set a timeout to prevent infinite waiting
            setTimeout(() => {
                if (!this.codeClient) {
                    reject(new Error('Google API failed to load within timeout'));
                }
            }, 10000); // 10 second timeout
        });

        return this.initializationPromise;
    }

    async handleAuthCodeResponse(response) {
        const loader = document.getElementById('landing-loader');

        if (response.error) {
            if (loader) loader.classList.remove('visible');
            events.emit(EVENT.SHOW_ERROR, 'OAuth failed: ' + response.error);
            return;
        }

        try {
            // Send authorization code to backend to exchange for tokens
            const data = await api.loginWithCode(response.code);

            if (data.success) {
                console.log('[AUTH] Login successful, updating state');

                state.update({
                    currentUser: data.user,
                    userSettings: data.user.settings || {
                        theme: 'dark',
                        weekStart: 0,
                        timezone: 'UTC',
                        dateFormat: 'DD-MM-YY',
                        showBreadcrumb: false,
                        showMarkdownEditor: false
                    },
                    isFirstLogin: data.user.isFirstLogin || false
                });

                console.log('[AUTH] Emitting auth-success event');
                // Emit event for UI to react (loader will be hidden by showApp)
                events.emit('auth-success');
            } else {
                if (loader) loader.classList.remove('visible');
                events.emit(EVENT.SHOW_ERROR, data.error || 'Login failed');
            }
        } catch (error) {
            if (loader) loader.classList.remove('visible');
            events.emit(EVENT.SHOW_ERROR, 'Login failed: ' + error.message);
        }
    }

    async signIn() {
        // Show loading indicator immediately
        const loader = document.getElementById('landing-loader');
        if (loader) loader.classList.add('visible');

        try {
            // Wait for initialization to complete if not already done
            await this.initializationPromise;

            if (!this.codeClient) {
                throw new Error('Google client not initialized');
            }

            // Request authorization code (will trigger popup)
            this.codeClient.requestCode();
        } catch (error) {
            console.error('[AUTH] Sign in failed:', error);
            if (loader) loader.classList.remove('visible');
            events.emit(EVENT.SHOW_ERROR, 'Failed to initialize Google sign-in. Please refresh the page.');
        }
    }

    signOut() {
        console.log('[AUTH] Starting logout...');
        
        // Call logout endpoint (don't wait for response)
        fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin'
        }).then(() => {
            console.log('[AUTH] Logout endpoint called');
        }).catch(err => {
            console.error('[AUTH] Logout endpoint error:', err);
        });

        // Clear localStorage and sessionStorage
        console.log('[AUTH] Clearing storage...');
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch (e) {
            console.error('[AUTH] Storage clear error:', e);
        }

        // Force reload immediately
        console.log('[AUTH] Forcing reload...');
        setTimeout(() => {
            window.location.href = '/';
            // Fallback in case href doesn't work
            setTimeout(() => window.location.reload(true), 100);
        }, 50);
    }

    async clearAllCaches() {
        try {
            // Clear IndexedDB
            const dbName = 'DailyNotesDB';
            const deleteRequest = indexedDB.deleteDatabase(dbName);

            await new Promise((resolve, reject) => {
                deleteRequest.onsuccess = () => {
                    console.log('[AUTH] IndexedDB cleared');
                    resolve();
                };
                deleteRequest.onerror = () => {
                    console.warn('[AUTH] Failed to clear IndexedDB');
                    resolve(); // Continue even if this fails
                };
            });

            // Clear all Service Worker caches
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(
                    cacheNames.map(cacheName => {
                        console.log('[AUTH] Deleting cache:', cacheName);
                        return caches.delete(cacheName);
                    })
                );
                console.log('[AUTH] All Service Worker caches cleared');
            }

            // Clear localStorage and sessionStorage
            localStorage.clear();
            sessionStorage.clear();
            console.log('[AUTH] Storage cleared');

        } catch (error) {
            console.error('[AUTH] Error clearing caches:', error);
            // Don't throw - we still want to complete logout
        }
    }
}

export const auth = new AuthManager();
