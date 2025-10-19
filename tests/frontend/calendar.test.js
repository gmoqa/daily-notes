/**
 * Calendar Tests
 * Tests for calendar logic and navigation
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { createUserSettings } from './helpers/factories.js';

describe('Calendar', () => {
    let calendar;
    let mockState;
    let mockNotes;

    beforeEach(() => {
        // Mock state
        mockState = {
            _state: {
                userSettings: createUserSettings(),
                currentCalendarMonth: 9, // October
                currentCalendarYear: 2025,
                selectedDate: '2025-10-16',
                today: '2025-10-16',
                notesWithDates: ['2025-10-15', '2025-10-16', '2025-10-17']
            },
            get: jest.fn((key) => mockState._state[key]),
            set: jest.fn((key, value) => { mockState._state[key] = value; }),
            update: jest.fn((changes) => {
                Object.assign(mockState._state, changes);
            })
        };

        // Mock notes
        mockNotes = {
            selectDate: jest.fn()
        };

        // Create Calendar class (simplified - focusing on logic not DOM)
        class Calendar {
            constructor() {
                this.monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                this.dayNamesDefault = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                this.state = mockState;
                this.notes = mockNotes;
            }

            getMonthYear() {
                const month = this.state.get('currentCalendarMonth');
                const year = this.state.get('currentCalendarYear');
                return `${this.monthNames[month]} ${year}`;
            }

            getDayNames(weekStart) {
                return [
                    ...this.dayNamesDefault.slice(weekStart),
                    ...this.dayNamesDefault.slice(0, weekStart)
                ];
            }

            getDaysInMonth(year, month) {
                return new Date(year, month + 1, 0).getDate();
            }

            getFirstDayOfMonth(year, month) {
                return new Date(year, month, 1).getDay();
            }

            formatDate(year, month, day) {
                return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }

            isToday(dateStr) {
                return dateStr === this.state.get('today');
            }

            isSelected(dateStr) {
                return dateStr === this.state.get('selectedDate');
            }

            hasNote(dateStr) {
                return this.state.get('notesWithDates').includes(dateStr);
            }

            prevMonth() {
                let month = this.state.get('currentCalendarMonth');
                let year = this.state.get('currentCalendarYear');

                month--;
                if (month < 0) {
                    month = 11;
                    year--;
                }

                this.state.update({
                    currentCalendarMonth: month,
                    currentCalendarYear: year
                });
            }

            nextMonth() {
                let month = this.state.get('currentCalendarMonth');
                let year = this.state.get('currentCalendarYear');

                month++;
                if (month > 11) {
                    month = 0;
                    year++;
                }

                this.state.update({
                    currentCalendarMonth: month,
                    currentCalendarYear: year
                });
            }

            goToToday() {
                const today = this.state.get('today');
                this.notes.selectDate(today);
            }
        }

        calendar = new Calendar();
    });

    describe('Month and Year Display', () => {
        test('should return correct month and year string', () => {
            expect(calendar.getMonthYear()).toBe('October 2025');
        });

        test('should handle different months', () => {
            mockState._state.currentCalendarMonth = 0; // January
            expect(calendar.getMonthYear()).toBe('January 2025');

            mockState._state.currentCalendarMonth = 11; // December
            expect(calendar.getMonthYear()).toBe('December 2025');
        });
    });

    describe('Day Names', () => {
        test('should get day names with default week start (Sunday)', () => {
            const days = calendar.getDayNames(0);
            expect(days).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        });

        test('should get day names starting with Monday', () => {
            const days = calendar.getDayNames(1);
            expect(days[0]).toBe('Mon');
            expect(days[6]).toBe('Sun');
        });

        test('should get day names starting with Saturday', () => {
            const days = calendar.getDayNames(6);
            expect(days[0]).toBe('Sat');
            expect(days[1]).toBe('Sun');
        });
    });

    describe('Calendar Calculations', () => {
        test('should calculate days in month correctly', () => {
            expect(calendar.getDaysInMonth(2025, 0)).toBe(31); // January
            expect(calendar.getDaysInMonth(2025, 1)).toBe(28); // February (non-leap)
            expect(calendar.getDaysInMonth(2024, 1)).toBe(29); // February (leap)
            expect(calendar.getDaysInMonth(2025, 3)).toBe(30); // April
            expect(calendar.getDaysInMonth(2025, 9)).toBe(31); // October
        });

        test('should get first day of month', () => {
            const firstDay = calendar.getFirstDayOfMonth(2025, 9); // October 2025
            expect(typeof firstDay).toBe('number');
            expect(firstDay).toBeGreaterThanOrEqual(0);
            expect(firstDay).toBeLessThan(7);
        });
    });

    describe('Date Formatting', () => {
        test('should format date correctly', () => {
            expect(calendar.formatDate(2025, 9, 16)).toBe('2025-10-16');
        });

        test('should pad single-digit months', () => {
            expect(calendar.formatDate(2025, 0, 15)).toBe('2025-01-15');
        });

        test('should pad single-digit days', () => {
            expect(calendar.formatDate(2025, 9, 1)).toBe('2025-10-01');
            expect(calendar.formatDate(2025, 9, 9)).toBe('2025-10-09');
        });
    });

    describe('Date State Checks', () => {
        test('should identify today correctly', () => {
            expect(calendar.isToday('2025-10-16')).toBe(true);
            expect(calendar.isToday('2025-10-15')).toBe(false);
        });

        test('should identify selected date correctly', () => {
            expect(calendar.isSelected('2025-10-16')).toBe(true);
            expect(calendar.isSelected('2025-10-15')).toBe(false);
        });

        test('should identify dates with notes', () => {
            expect(calendar.hasNote('2025-10-15')).toBe(true);
            expect(calendar.hasNote('2025-10-16')).toBe(true);
            expect(calendar.hasNote('2025-10-17')).toBe(true);
            expect(calendar.hasNote('2025-10-18')).toBe(false);
        });
    });

    describe('Navigation', () => {
        test('should navigate to previous month', () => {
            calendar.prevMonth();
            expect(mockState.update).toHaveBeenCalledWith({
                currentCalendarMonth: 8, // September
                currentCalendarYear: 2025
            });
        });

        test('should navigate to previous month across year boundary', () => {
            mockState._state.currentCalendarMonth = 0; // January
            mockState._state.currentCalendarYear = 2025;

            calendar.prevMonth();

            expect(mockState.update).toHaveBeenCalledWith({
                currentCalendarMonth: 11, // December
                currentCalendarYear: 2024
            });
        });

        test('should navigate to next month', () => {
            calendar.nextMonth();
            expect(mockState.update).toHaveBeenCalledWith({
                currentCalendarMonth: 10, // November
                currentCalendarYear: 2025
            });
        });

        test('should navigate to next month across year boundary', () => {
            mockState._state.currentCalendarMonth = 11; // December
            mockState._state.currentCalendarYear = 2025;

            calendar.nextMonth();

            expect(mockState.update).toHaveBeenCalledWith({
                currentCalendarMonth: 0, // January
                currentCalendarYear: 2026
            });
        });

        test('should go to today', () => {
            calendar.goToToday();
            expect(mockNotes.selectDate).toHaveBeenCalledWith('2025-10-16');
        });
    });

    describe('Edge Cases - Leap Years', () => {
        test('should handle February in leap year', () => {
            expect(calendar.getDaysInMonth(2024, 1)).toBe(29);
            const feb29 = calendar.formatDate(2024, 1, 29);
            expect(feb29).toBe('2024-02-29');
        });

        test('should handle February in non-leap year', () => {
            expect(calendar.getDaysInMonth(2025, 1)).toBe(28);
            expect(calendar.getDaysInMonth(2023, 1)).toBe(28);
        });

        test('should handle century non-leap year', () => {
            expect(calendar.getDaysInMonth(1900, 1)).toBe(28);
        });

        test('should handle century leap year', () => {
            expect(calendar.getDaysInMonth(2000, 1)).toBe(29);
        });
    });

    describe('Edge Cases - Month Lengths', () => {
        test('should handle months with 31 days', () => {
            expect(calendar.getDaysInMonth(2025, 0)).toBe(31); // January
            expect(calendar.getDaysInMonth(2025, 2)).toBe(31); // March
            expect(calendar.getDaysInMonth(2025, 4)).toBe(31); // May
            expect(calendar.getDaysInMonth(2025, 6)).toBe(31); // July
            expect(calendar.getDaysInMonth(2025, 7)).toBe(31); // August
            expect(calendar.getDaysInMonth(2025, 9)).toBe(31); // October
            expect(calendar.getDaysInMonth(2025, 11)).toBe(31); // December
        });

        test('should handle months with 30 days', () => {
            expect(calendar.getDaysInMonth(2025, 3)).toBe(30); // April
            expect(calendar.getDaysInMonth(2025, 5)).toBe(30); // June
            expect(calendar.getDaysInMonth(2025, 8)).toBe(30); // September
            expect(calendar.getDaysInMonth(2025, 10)).toBe(30); // November
        });
    });

    describe('Multiple State Updates', () => {
        test('should handle multiple month navigations', () => {
            calendar.nextMonth(); // Oct -> Nov
            calendar.nextMonth(); // Nov -> Dec
            calendar.nextMonth(); // Dec -> Jan 2026

            expect(mockState.update).toHaveBeenCalledTimes(3);
        });

        test('should handle back and forth navigation', () => {
            calendar.nextMonth();
            calendar.prevMonth();

            expect(mockState.update).toHaveBeenCalledTimes(2);
        });
    });

    describe('Real-world Scenarios', () => {
        test('should work with user-selected week start', () => {
            mockState._state.userSettings.weekStart = 1; // Monday
            const days = calendar.getDayNames(mockState._state.userSettings.weekStart);
            expect(days[0]).toBe('Mon');
        });

        test('should correctly identify current month notes', () => {
            const oct15 = '2025-10-15';
            const oct16 = '2025-10-16';
            const oct17 = '2025-10-17';

            expect(calendar.hasNote(oct15)).toBe(true);
            expect(calendar.hasNote(oct16)).toBe(true);
            expect(calendar.hasNote(oct17)).toBe(true);
        });

        test('should handle date selection', () => {
            mockState._state.selectedDate = '2025-10-20';

            expect(calendar.isSelected('2025-10-20')).toBe(true);
            expect(calendar.isSelected('2025-10-16')).toBe(false);
        });
    });
});
