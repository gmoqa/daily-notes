/**
 * Professional Notification System
 * Handles toast notifications with queuing, stacking, and animations
 */

class NotificationManager {
    constructor() {
        this.container = null;
        this.notifications = new Map();
        this.queue = [];
        this.maxVisible = 3;
        this.defaultDuration = 5000;
        this.init();
    }

    init() {
        // Create notification container
        this.container = document.createElement('div');
        this.container.id = 'notification-container';
        this.container.className = 'notification-container';
        this.container.setAttribute('role', 'region');
        this.container.setAttribute('aria-label', 'Notifications');
        document.body.appendChild(this.container);
    }

    /**
     * Show a notification
     * @param {Object} options - Notification options
     * @param {string} options.type - Type: 'success', 'error', 'warning', 'info'
     * @param {string} options.title - Notification title
     * @param {string} options.message - Notification message
     * @param {number} options.duration - Duration in ms (0 for persistent)
     * @param {boolean} options.dismissible - Can be manually dismissed
     * @param {Function} options.onAction - Callback for action button
     * @param {string} options.actionLabel - Label for action button
     */
    show(options) {
        const {
            type = 'info',
            title,
            message,
            duration = this.defaultDuration,
            dismissible = true,
            onAction,
            actionLabel = 'Action'
        } = options;

        const id = `notification-${Date.now()}-${Math.random()}`;

        const notification = {
            id,
            type,
            title,
            message,
            duration,
            dismissible,
            onAction,
            actionLabel,
            element: null
        };

        // Add to queue if at max capacity
        const visibleCount = this.container.children.length;
        if (visibleCount >= this.maxVisible) {
            this.queue.push(notification);
            return id;
        }

        this.render(notification);
        return id;
    }

    render(notification) {
        const { id, type, title, message, duration, dismissible, onAction, actionLabel } = notification;

        // Create notification element
        const element = document.createElement('div');
        element.className = `notification-toast notification-${type}`;
        element.setAttribute('role', 'alert');
        element.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        element.dataset.id = id;

        // Icon mapping
        const icons = {
            success: 'check_circle',
            error: 'error',
            warning: 'warning',
            info: 'info'
        };

        // Build HTML
        element.innerHTML = `
            <div class="notification-icon">
                <span class="material-symbols-outlined">${icons[type]}</span>
            </div>
            <div class="notification-content">
                ${title ? `<div class="notification-title">${this.escapeHtml(title)}</div>` : ''}
                <div class="notification-message">${this.escapeHtml(message)}</div>
            </div>
            ${onAction ? `
                <button class="notification-action" aria-label="${actionLabel}">
                    ${actionLabel}
                </button>
            ` : ''}
            ${dismissible ? `
                <button class="notification-close" aria-label="Close notification">
                    <span class="material-symbols-outlined">close</span>
                </button>
            ` : ''}
        `;

        // Add event listeners
        if (dismissible) {
            const closeBtn = element.querySelector('.notification-close');
            closeBtn.addEventListener('click', () => this.dismiss(id));
        }

        if (onAction) {
            const actionBtn = element.querySelector('.notification-action');
            actionBtn.addEventListener('click', () => {
                onAction();
                this.dismiss(id);
            });
        }

        // Add to DOM with animation
        this.container.appendChild(element);
        notification.element = element;
        this.notifications.set(id, notification);

        // Trigger animation
        requestAnimationFrame(() => {
            element.classList.add('notification-visible');
        });

        // Auto-dismiss after duration
        if (duration > 0) {
            notification.timeout = setTimeout(() => {
                this.dismiss(id);
            }, duration);
        }
    }

    dismiss(id) {
        const notification = this.notifications.get(id);
        if (!notification) return;

        const { element, timeout } = notification;

        // Clear timeout
        if (timeout) {
            clearTimeout(timeout);
        }

        // Animate out
        element.classList.remove('notification-visible');
        element.classList.add('notification-hiding');

        // Remove from DOM after animation
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.notifications.delete(id);

            // Show next queued notification
            this.processQueue();
        }, 300);
    }

    processQueue() {
        const visibleCount = this.container.children.length;
        if (this.queue.length > 0 && visibleCount < this.maxVisible) {
            const next = this.queue.shift();
            this.render(next);
        }
    }

    // Convenience methods
    success(message, options = {}) {
        return this.show({ type: 'success', message, title: 'Success', ...options });
    }

    error(message, options = {}) {
        return this.show({
            type: 'error',
            message,
            title: 'Error',
            duration: 7000, // Longer for errors
            ...options
        });
    }

    warning(message, options = {}) {
        return this.show({ type: 'warning', message, title: 'Warning', ...options });
    }

    info(message, options = {}) {
        return this.show({ type: 'info', message, ...options });
    }

    // Clear all notifications
    clearAll() {
        this.notifications.forEach((notification) => {
            this.dismiss(notification.id);
        });
        this.queue = [];
    }

    // Utility: Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create singleton instance
export const notifications = new NotificationManager();
