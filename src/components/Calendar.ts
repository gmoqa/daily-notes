/**
 * Calendar Module
 * Handles calendar rendering and navigation
 */

import { state } from '@/utils/state'
import { notes } from '@/services/notes'

class Calendar {
  private monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]
  private dayNamesDefault = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  render(): void {
    const settings = state.get('userSettings')
    const weekStart = settings.weekStart || 0
    const month = state.get('currentCalendarMonth')
    const year = state.get('currentCalendarYear')
    const selectedDate = state.get('selectedDate')
    const today = (state as any).get('today') as string
    const notesWithDates = state.get('notesWithDates')

    const dayNames = [
      ...this.dayNamesDefault.slice(weekStart),
      ...this.dayNamesDefault.slice(0, weekStart)
    ]

    const monthYearEl = document.getElementById('calendar-month-year')
    if (monthYearEl) {
      monthYearEl.textContent = `${this.monthNames[month]} ${year}`
    }

    const firstDayOfMonth = new Date(year, month, 1).getDay()
    const adjustedFirstDay = (firstDayOfMonth - weekStart + 7) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const daysInPrevMonth = new Date(year, month, 0).getDate()

    const grid = document.getElementById('calendar-grid')
    if (!grid) return

    // Render day headers
    let html = dayNames.map(day => `<div class="calendar-day-header">${day}</div>`).join('')

    // Render previous month's trailing days
    for (let i = adjustedFirstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i
      html += `<div class="calendar-day other-month">${day}</div>`
    }

    // Render current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const classes = ['calendar-day']

      if (dateStr === today) classes.push('today')
      if (dateStr === selectedDate) classes.push('selected')
      if (notesWithDates.includes(dateStr)) classes.push('has-note')

      html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${day}</div>`
    }

    // Render next month's leading days
    const totalCells = adjustedFirstDay + daysInMonth
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)
    for (let day = 1; day <= remainingCells; day++) {
      html += `<div class="calendar-day other-month">${day}</div>`
    }

    grid.innerHTML = html

    // Add click handlers
    grid.querySelectorAll('.calendar-day:not(.other-month)').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        const dateStr = (dayEl as HTMLElement).dataset.date
        if (dateStr) {
          notes.selectDate(dateStr)
        }
      })
    })
  }

  prevMonth(): void {
    let month = state.get('currentCalendarMonth')
    let year = state.get('currentCalendarYear')

    month--
    if (month < 0) {
      month = 11
      year--
    }

    state.update({
      currentCalendarMonth: month,
      currentCalendarYear: year
    })

    this.render()
  }

  nextMonth(): void {
    let month = state.get('currentCalendarMonth')
    let year = state.get('currentCalendarYear')

    month++
    if (month > 11) {
      month = 0
      year++
    }

    state.update({
      currentCalendarMonth: month,
      currentCalendarYear: year
    })

    this.render()
  }

  goToToday(): void {
    const today = (state as any).get('today') as string
    notes.selectDate(today)
  }
}

export const calendar = new Calendar()
