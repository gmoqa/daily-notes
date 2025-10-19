/**
 * Color Utilities
 */

export function getColorLabel(color: string): string {
    const labels: { [key: string]: string } = {
        'text': 'Text (Gray)',
        'link': 'Link (Blue)',
        'primary': 'Primary (Cyan)',
        'info': 'Info (Light Blue)',
        'success': 'Success (Green)',
        'warning': 'Warning (Yellow)',
        'danger': 'Danger (Red)'
    }
    return labels[color] || color
}

export function normalizeToBulmaColor(color: string): string {
    // If it's already a Bulma color name, return it
    const bulmaColors = ['text', 'link', 'primary', 'info', 'success', 'warning', 'danger']
    if (bulmaColors.includes(color)) {
        return color
    }

    // Map old hex colors to closest Bulma color
    const hexToColor: { [key: string]: string } = {
        '#485fc7': 'primary',
        '#3e8ed0': 'info',
        '#48c78e': 'success',
        '#ffe08a': 'warning',
        '#f14668': 'danger'
    }

    return hexToColor[color] || 'primary'
}

export function setupColorButtons(hiddenInputId: string, containerId: string): void {
    const hiddenInput = document.getElementById(hiddenInputId) as HTMLInputElement | null

    // Get fresh button references each time
    const buttons = document.querySelectorAll(`#${containerId} .color-btn`)
    if (!buttons.length) return

    buttons.forEach(button => {
        // Remove old listeners by cloning
        const newButton = button.cloneNode(true) as Element
        const parent = button.parentNode
        if (parent) {
            parent.replaceChild(newButton, button)
        }
    })

    // Get fresh references after cloning
    const colorButtons = document.querySelectorAll(`#${containerId} .color-btn`)

    colorButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault()
            const color = (button as HTMLElement).dataset.color

            // Update hidden input
            if (hiddenInput && color) hiddenInput.value = color

            // Update active state - get fresh references again
            const allButtons = document.querySelectorAll(`#${containerId} .color-btn`)
            allButtons.forEach(btn => {
                const element = btn as HTMLElement
                element.classList.remove('is-active')
                element.style.border = '3px solid transparent'
                element.style.borderRadius = '8px'
            })

            const element = button as HTMLElement
            element.classList.add('is-active')
            element.style.border = '3px solid var(--bulma-text)'
            element.style.borderRadius = '8px'
        })
    })
}

export function selectColorButton(color: string, containerId: string, hiddenInputId: string): void {
    const colorButtons = document.querySelectorAll(`#${containerId} .color-btn`)
    const hiddenInput = document.getElementById(hiddenInputId) as HTMLInputElement | null

    if (hiddenInput) hiddenInput.value = color

    colorButtons.forEach(btn => {
        const element = btn as HTMLElement
        element.classList.remove('is-active')
        element.style.border = '3px solid transparent'
        element.style.borderRadius = '8px'

        if (element.dataset.color === color) {
            element.classList.add('is-active')
            element.style.border = `3px solid var(--bulma-text)`
            element.style.borderRadius = '8px'
        }
    })
}
