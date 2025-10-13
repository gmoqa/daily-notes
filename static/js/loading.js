/**
 * Loading States Manager
 * Handles loading indicators, progress bars, and skeleton screens
 */

class LoadingManager {
    constructor() {
        this.activeLoaders = new Map();
        this.overlay = null;
        this.initOverlay();
    }

    initOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'loading-overlay';
        this.overlay.className = 'loading-overlay';
        this.overlay.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner-ring"></div>
                <div class="spinner-ring"></div>
                <div class="spinner-ring"></div>
            </div>
            <div class="loading-text">Loading...</div>
        `;
        document.body.appendChild(this.overlay);
    }

    /**
     * Show global loading overlay
     * @param {string} message - Loading message
     */
    show(message = 'Loading...') {
        const textEl = this.overlay.querySelector('.loading-text');
        if (textEl) {
            textEl.textContent = message;
        }
        this.overlay.classList.add('loading-overlay-visible');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hide global loading overlay
     */
    hide() {
        this.overlay.classList.remove('loading-overlay-visible');
        document.body.style.overflow = '';
    }

    /**
     * Show loading state for a specific element
     * @param {string|HTMLElement} target - Target element or selector
     * @param {Object} options - Loading options
     */
    showElement(target, options = {}) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;
        if (!element) return;

        const {
            text = 'Loading...',
            size = 'medium', // small, medium, large
            overlay = false // Add dark overlay
        } = options;

        // Store original content
        const id = this.generateId();
        this.activeLoaders.set(id, {
            element,
            originalContent: element.innerHTML,
            originalPosition: element.style.position
        });

        // Create loader HTML
        const sizeClass = `spinner-${size}`;
        const overlayClass = overlay ? 'with-overlay' : '';

        element.style.position = 'relative';
        element.insertAdjacentHTML('beforeend', `
            <div class="element-loader ${overlayClass}" data-loader-id="${id}">
                <div class="element-loader-content">
                    <div class="spinner ${sizeClass}">
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                    </div>
                    ${text ? `<div class="loader-text">${text}</div>` : ''}
                </div>
            </div>
        `);

        return id;
    }

    /**
     * Hide loading state for a specific element
     * @param {string} id - Loader ID returned from showElement
     */
    hideElement(id) {
        const loader = this.activeLoaders.get(id);
        if (!loader) return;

        const { element, originalPosition } = loader;
        const loaderEl = element.querySelector(`[data-loader-id="${id}"]`);

        if (loaderEl) {
            loaderEl.classList.add('element-loader-hiding');
            setTimeout(() => {
                loaderEl.remove();
                element.style.position = originalPosition;
            }, 300);
        }

        this.activeLoaders.delete(id);
    }

    /**
     * Show inline spinner
     * @param {string|HTMLElement} target - Target element
     * @param {string} size - Size: small, medium, large
     */
    showInline(target, size = 'small') {
        const element = typeof target === 'string' ? document.querySelector(target) : target;
        if (!element) return;

        const spinner = document.createElement('span');
        spinner.className = `spinner-inline spinner-${size}`;
        spinner.innerHTML = `
            <span class="spinner-dot"></span>
            <span class="spinner-dot"></span>
            <span class="spinner-dot"></span>
        `;

        element.appendChild(spinner);
        return spinner;
    }

    /**
     * Show progress bar
     * @param {string|HTMLElement} target - Target container
     * @param {number} progress - Progress percentage (0-100)
     */
    showProgress(target, progress = 0) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;
        if (!element) return;

        let progressBar = element.querySelector('.progress-bar-container');

        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.className = 'progress-bar-container';
            progressBar.innerHTML = `
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${progress}%"></div>
                </div>
            `;
            element.appendChild(progressBar);
        } else {
            const fill = progressBar.querySelector('.progress-bar-fill');
            if (fill) {
                fill.style.width = `${progress}%`;
            }
        }

        return progressBar;
    }

    /**
     * Hide progress bar
     */
    hideProgress(target) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;
        if (!element) return;

        const progressBar = element.querySelector('.progress-bar-container');
        if (progressBar) {
            progressBar.classList.add('progress-bar-hiding');
            setTimeout(() => progressBar.remove(), 300);
        }
    }

    /**
     * Show skeleton screen
     * @param {string|HTMLElement} target - Target element
     * @param {Object} options - Skeleton options
     */
    showSkeleton(target, options = {}) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;
        if (!element) return;

        const {
            rows = 3,
            avatar = false,
            style = 'pulse' // pulse, wave
        } = options;

        const id = this.generateId();
        this.activeLoaders.set(id, {
            element,
            originalContent: element.innerHTML
        });

        let skeletonHTML = `<div class="skeleton-loader skeleton-${style}" data-skeleton-id="${id}">`;

        if (avatar) {
            skeletonHTML += '<div class="skeleton skeleton-avatar"></div>';
        }

        for (let i = 0; i < rows; i++) {
            const width = 60 + Math.random() * 40; // Random width 60-100%
            skeletonHTML += `<div class="skeleton skeleton-line" style="width: ${width}%;"></div>`;
        }

        skeletonHTML += '</div>';
        element.innerHTML = skeletonHTML;

        return id;
    }

    /**
     * Hide skeleton screen
     */
    hideSkeleton(id) {
        const loader = this.activeLoaders.get(id);
        if (!loader) return;

        const { element, originalContent } = loader;
        const skeletonEl = element.querySelector(`[data-skeleton-id="${id}"]`);

        if (skeletonEl) {
            skeletonEl.classList.add('skeleton-hiding');
            setTimeout(() => {
                element.innerHTML = originalContent;
            }, 300);
        }

        this.activeLoaders.delete(id);
    }

    // Utility methods
    generateId() {
        return `loader-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    clearAll() {
        this.hide();
        this.activeLoaders.forEach((loader, id) => {
            const { element } = loader;
            const loaderEl = element.querySelector(`[data-loader-id="${id}"]`);
            const skeletonEl = element.querySelector(`[data-skeleton-id="${id}"]`);

            if (loaderEl) loaderEl.remove();
            if (skeletonEl) skeletonEl.remove();
        });
        this.activeLoaders.clear();
    }
}

// Create singleton instance
export const loading = new LoadingManager();
