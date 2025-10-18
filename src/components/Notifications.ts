/**
 * Professional Notification System
 * Handles toast notifications with queuing, stacking, and animations
 */

interface NotificationOptions {
  type?: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  duration?: number
  dismissible?: boolean
  onAction?: () => void
  actionLabel?: string
}

interface Notification extends NotificationOptions {
  id: string
  element: HTMLElement | null
  timeout?: number
}

class NotificationManager {
  private container: HTMLElement
  private notifications = new Map<string, Notification>()
  private queue: Notification[] = []
  private readonly maxVisible = 3
  private readonly defaultDuration = 5000

  constructor() {
    this.container = this.init()
  }

  private init(): HTMLElement {
    // Create notification container
    const container = document.createElement('div')
    container.id = 'notification-container'
    container.className = 'notification-container'
    container.setAttribute('role', 'region')
    container.setAttribute('aria-label', 'Notifications')
    document.body.appendChild(container)
    return container
  }

  /**
   * Show a notification
   */
  show(options: NotificationOptions): string {
    const {
      type = 'info',
      title,
      message,
      duration = this.defaultDuration,
      dismissible = true,
      onAction,
      actionLabel = 'Action'
    } = options

    const id = `notification-${Date.now()}-${Math.random()}`

    const notification: Notification = {
      id,
      type,
      title,
      message,
      duration,
      dismissible,
      onAction,
      actionLabel,
      element: null
    }

    // Add to queue if at max capacity
    const visibleCount = this.container.children.length
    if (visibleCount >= this.maxVisible) {
      this.queue.push(notification)
      return id
    }

    this.render(notification)
    return id
  }

  private render(notification: Notification): void {
    const { id, type, title, message, duration, dismissible, onAction, actionLabel } = notification

    // Create notification element
    const element = document.createElement('div')
    element.className = `notification-toast notification-${type}`
    element.setAttribute('role', 'alert')
    element.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite')
    element.dataset.id = id

    // Icon mapping
    const icons = {
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      info: 'info'
    }

    // Build HTML
    element.innerHTML = `
      <div class="notification-icon">
        <span class="material-symbols-outlined">${icons[type!]}</span>
      </div>
      <div class="notification-content">
        ${title ? `<div class="notification-title">${this.escapeHtml(title)}</div>` : ''}
        <div class="notification-message">${this.escapeHtml(message)}</div>
      </div>
      ${
        onAction
          ? `
        <button class="notification-action" aria-label="${actionLabel}">
          ${actionLabel}
        </button>
      `
          : ''
      }
      ${
        dismissible
          ? `
        <button class="notification-close" aria-label="Close notification">
          <span class="material-symbols-outlined">close</span>
        </button>
      `
          : ''
      }
    `

    // Add event listeners
    if (dismissible) {
      const closeBtn = element.querySelector('.notification-close')
      closeBtn?.addEventListener('click', () => this.dismiss(id))
    }

    if (onAction) {
      const actionBtn = element.querySelector('.notification-action')
      actionBtn?.addEventListener('click', () => {
        onAction()
        this.dismiss(id)
      })
    }

    // Add to DOM with animation
    this.container.appendChild(element)
    notification.element = element
    this.notifications.set(id, notification)

    // Trigger animation
    requestAnimationFrame(() => {
      element.classList.add('notification-visible')
    })

    // Auto-dismiss after duration
    if (duration && duration > 0) {
      notification.timeout = window.setTimeout(() => {
        this.dismiss(id)
      }, duration)
    }
  }

  dismiss(id: string): void {
    const notification = this.notifications.get(id)
    if (!notification) return

    const { element, timeout } = notification

    // Clear timeout
    if (timeout) {
      clearTimeout(timeout)
    }

    // Animate out
    element?.classList.remove('notification-visible')
    element?.classList.add('notification-hiding')

    // Remove from DOM after animation
    setTimeout(() => {
      if (element?.parentNode) {
        element.parentNode.removeChild(element)
      }
      this.notifications.delete(id)

      // Show next queued notification
      this.processQueue()
    }, 300)
  }

  private processQueue(): void {
    const visibleCount = this.container.children.length
    if (this.queue.length > 0 && visibleCount < this.maxVisible) {
      const next = this.queue.shift()
      if (next) {
        this.render(next)
      }
    }
  }

  // Convenience methods
  success(message: string, options: Partial<NotificationOptions> = {}): string {
    return this.show({ type: 'success', message, title: 'Success', ...options })
  }

  error(message: string, options: Partial<NotificationOptions> = {}): string {
    return this.show({
      type: 'error',
      message,
      title: 'Error',
      duration: 7000, // Longer for errors
      ...options
    })
  }

  warning(message: string, options: Partial<NotificationOptions> = {}): string {
    return this.show({ type: 'warning', message, title: 'Warning', ...options })
  }

  info(message: string, options: Partial<NotificationOptions> = {}): string {
    return this.show({ type: 'info', message, ...options })
  }

  // Clear all notifications
  clearAll(): void {
    this.notifications.forEach(notification => {
      this.dismiss(notification.id)
    })
    this.queue = []
  }

  // Utility: Escape HTML
  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }
}

// Create singleton instance
export const notifications = new NotificationManager()
