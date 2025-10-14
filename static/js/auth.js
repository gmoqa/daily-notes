/**
 * Authentication Module
 * Handles Google OAuth and session management
 */

import { state } from './state.js';
import { api } from './api.js';
import { events, EVENT } from './events.js';

class AuthManager {
    constructor() {
        this.tokenClient = null;
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

    initGoogleClient(clientId) {
        if (!this.tokenClient) {
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'https://www.googleapis.com/auth/drive.file openid profile email',
                callback: (tokenResponse) => this.handleGoogleLogin(tokenResponse)
            });
        }
    }

    async handleGoogleLogin(tokenResponse) {
        const loader = document.getElementById('landing-loader');

        if (tokenResponse.error) {
            if (loader) loader.classList.remove('visible');
            events.emit(EVENT.SHOW_ERROR, 'OAuth failed: ' + tokenResponse.error);
            return;
        }

        try {
            const data = await api.login(
                tokenResponse.access_token,
                tokenResponse.expires_in || 3600
            );

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
                    }
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

    signIn() {
        if (!this.tokenClient) {
            events.emit(EVENT.SHOW_ERROR, 'Google client not initialized');
            return;
        }

        // Show loading indicator
        const loader = document.getElementById('landing-loader');
        if (loader) loader.classList.add('visible');

        this.tokenClient.requestAccessToken({ prompt: '' });
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
