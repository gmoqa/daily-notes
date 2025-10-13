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
                    timezone: 'UTC'
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
                        timezone: 'UTC'
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

    async signOut() {
        try {
            state.set('isLoggingOut', true);
            await api.logout();

            state.update({
                currentUser: null,
                contexts: [],
                notes: [],
                selectedContext: null,
                selectedDate: null
            });

            if (this.tokenClient && google.accounts.oauth2.revoke) {
                google.accounts.oauth2.revoke(this.tokenClient.access_token);
            }

            events.emit('auth-logout');

            setTimeout(() => {
                state.set('isLoggingOut', false);
            }, 1000);
        } catch (error) {
            state.set('isLoggingOut', false);
            events.emit(EVENT.SHOW_ERROR, 'Logout failed');
        }
    }
}

export const auth = new AuthManager();
