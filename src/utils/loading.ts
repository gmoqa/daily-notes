/**
 * Loading States Manager
 * Handles loading indicators, progress bars, and skeleton screens
 */

interface LoaderState {
  element: HTMLElement
  originalContent: string
  originalPosition: string
}

interface ShowElementOptions {
  text?: string
  size?: 'small' | 'medium' | 'large'
  overlay?: boolean
}

interface SkeletonOptions {
  rows?: number
  avatar?: boolean
  style?: 'pulse' | 'wave'
}

class LoadingManager {
  private activeLoaders = new Map<string, LoaderState>()
  private overlay: HTMLElement

  constructor() {
    this.overlay = this.initOverlay()
  }

  private initOverlay(): HTMLElement {
    const overlay = document.createElement('div')
    overlay.id = 'loading-overlay'
    overlay.className = 'loading-overlay'
    overlay.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner-ring"></div>
        <div class="spinner-ring"></div>
        <div class="spinner-ring"></div>
      </div>
      <div class="loading-text">Loading...</div>
    `
    document.body.appendChild(overlay)
    return overlay
  }

  /**
   * Show global loading overlay
   */
  show(message = 'Loading...'): void {
    const textEl = this.overlay.querySelector('.loading-text')
    if (textEl) {
      textEl.textContent = message
    }
    this.overlay.classList.add('loading-overlay-visible')
    document.body.style.overflow = 'hidden'
  }

  /**
   * Hide global loading overlay
   */
  hide(): void {
    this.overlay.classList.remove('loading-overlay-visible')
    document.body.style.overflow = ''
  }

  /**
   * Show loading state for a specific element
   */
  showElement(target: string | HTMLElement, options: ShowElementOptions = {}): string {
    const element = typeof target === 'string' ? document.querySelector(target) : target
    if (!element) return ''

    const {
      text = 'Loading...',
      size = 'medium',
      overlay = false
    } = options

    // Store original content
    const id = this.generateId()
    this.activeLoaders.set(id, {
      element: element as HTMLElement,
      originalContent: element.innerHTML,
      originalPosition: (element as HTMLElement).style.position
    })

    // Create loader HTML
    const sizeClass = `spinner-${size}`
    const overlayClass = overlay ? 'with-overlay' : ''

    ;(element as HTMLElement).style.position = 'relative'
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
    `)

    return id
  }

  /**
   * Hide loading state for a specific element
   */
  hideElement(id: string): void {
    const loader = this.activeLoaders.get(id)
    if (!loader) return

    const { element, originalPosition } = loader
    const loaderEl = element.querySelector(`[data-loader-id="${id}"]`)

    if (loaderEl) {
      loaderEl.classList.add('element-loader-hiding')
      setTimeout(() => {
        loaderEl.remove()
        element.style.position = originalPosition
      }, 300)
    }

    this.activeLoaders.delete(id)
  }

  /**
   * Show inline spinner
   */
  showInline(target: string | HTMLElement, size: 'small' | 'medium' | 'large' = 'small'): HTMLSpanElement | null {
    const element = typeof target === 'string' ? document.querySelector(target) : target
    if (!element) return null

    const spinner = document.createElement('span')
    spinner.className = `spinner-inline spinner-${size}`
    spinner.innerHTML = `
      <span class="spinner-dot"></span>
      <span class="spinner-dot"></span>
      <span class="spinner-dot"></span>
    `

    element.appendChild(spinner)
    return spinner
  }

  /**
   * Show progress bar
   */
  showProgress(target: string | HTMLElement, progress = 0): HTMLDivElement | null {
    const element = typeof target === 'string' ? document.querySelector(target) : target
    if (!element) return null

    let progressBar = element.querySelector('.progress-bar-container') as HTMLDivElement | null

    if (!progressBar) {
      progressBar = document.createElement('div')
      progressBar.className = 'progress-bar-container'
      progressBar.innerHTML = `
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width: ${progress}%"></div>
        </div>
      `
      element.appendChild(progressBar)
    } else {
      const fill = progressBar.querySelector('.progress-bar-fill') as HTMLDivElement
      if (fill) {
        fill.style.width = `${progress}%`
      }
    }

    return progressBar
  }

  /**
   * Hide progress bar
   */
  hideProgress(target: string | HTMLElement): void {
    const element = typeof target === 'string' ? document.querySelector(target) : target
    if (!element) return

    const progressBar = element.querySelector('.progress-bar-container')
    if (progressBar) {
      progressBar.classList.add('progress-bar-hiding')
      setTimeout(() => progressBar.remove(), 300)
    }
  }

  /**
   * Show skeleton screen
   */
  showSkeleton(target: string | HTMLElement, options: SkeletonOptions = {}): string {
    const element = typeof target === 'string' ? document.querySelector(target) : target
    if (!element) return ''

    const {
      rows = 3,
      avatar = false,
      style = 'pulse'
    } = options

    const id = this.generateId()
    this.activeLoaders.set(id, {
      element: element as HTMLElement,
      originalContent: element.innerHTML,
      originalPosition: ''
    })

    let skeletonHTML = `<div class="skeleton-loader skeleton-${style}" data-skeleton-id="${id}">`

    if (avatar) {
      skeletonHTML += '<div class="skeleton skeleton-avatar"></div>'
    }

    for (let i = 0; i < rows; i++) {
      const width = 60 + Math.random() * 40 // Random width 60-100%
      skeletonHTML += `<div class="skeleton skeleton-line" style="width: ${width}%;"></div>`
    }

    skeletonHTML += '</div>'
    element.innerHTML = skeletonHTML

    return id
  }

  /**
   * Hide skeleton screen
   */
  hideSkeleton(id: string): void {
    const loader = this.activeLoaders.get(id)
    if (!loader) return

    const { element, originalContent } = loader
    const skeletonEl = element.querySelector(`[data-skeleton-id="${id}"]`)

    if (skeletonEl) {
      skeletonEl.classList.add('skeleton-hiding')
      setTimeout(() => {
        element.innerHTML = originalContent
      }, 300)
    }

    this.activeLoaders.delete(id)
  }

  // Utility methods
  private generateId(): string {
    return `loader-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  clearAll(): void {
    this.hide()
    this.activeLoaders.forEach((loader, id) => {
      const { element } = loader
      const loaderEl = element.querySelector(`[data-loader-id="${id}"]`)
      const skeletonEl = element.querySelector(`[data-skeleton-id="${id}"]`)

      if (loaderEl) loaderEl.remove()
      if (skeletonEl) skeletonEl.remove()
    })
    this.activeLoaders.clear()
  }
}

// Create singleton instance
export const loading = new LoadingManager()
