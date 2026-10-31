import { describe, it, expect } from 'vitest';
import {
  getCalendarDateKey,
  getWeekRange,
  getNextWeekRange,
  getPrevWeekRange,
  getMonthRange,
  getMonthGrid,
  getDayRange,
  getNextDayDate,
  getPrevDayDate,
  formatDayLabel,
  formatWeekLabel,
  formatMonthLabel,
  getLocalParts,
  createUtcFromLocal,
  getDaysInMonth,
  toLocalDatetimeString,
  parseLocalDatetimeString,
  getItemHourInTimeZone,
} from '../src/lib/temporal/calendar';
import { DEFAULT_TIMEZONE, APPROVED_REQUIREMENT_ALIAS } from '../src/lib/temporal/timezone';

describe('Calendar Temporal Utilities (Phase 4, Step 1)', () => {
  describe('getCalendarDateKey', () => {
    it('maps UTC timestamps to local YYYY-MM-DD date key in Cairo', () => {
      // Winter Standard Time (UTC+2): 2026-01-15T21:00:00Z is 23:00 on Jan 15 in Cairo
      expect(getCalendarDateKey('2026-01-15T21:00:00Z', 'Africa/Cairo')).toBe('2026-01-15');
      // Winter Standard Time (UTC+2): 2026-01-15T22:30:00Z is 00:30 on Jan 16 in Cairo
      expect(getCalendarDateKey('2026-01-15T22:30:00Z', 'Africa/Cairo')).toBe('2026-01-16');

      // Summer Daylight Saving Time (UTC+3): 2026-07-15T20:00:00Z is 23:00 on July 15 in Cairo
      expect(getCalendarDateKey('2026-07-15T20:00:00Z', 'Africa/Cairo')).toBe('2026-07-15');
      // Summer Daylight Saving Time (UTC+3): 2026-07-15T21:30:00Z is 00:30 on July 16 in Cairo
      expect(getCalendarDateKey('2026-07-15T21:30:00Z', 'Africa/Cairo')).toBe('2026-07-16');
    });

    it('maps the exact same instant to different local dates across different timezones', () => {
      // 2026-10-31T23:30:00Z
      const instant = '2026-10-31T23:30:00.000Z';

      // UTC is 23:30 on Oct 31
      expect(getCalendarDateKey(instant, 'UTC')).toBe('2026-10-31');

      // Cairo (UTC+2 in winter) is 01:30 on Nov 1
      expect(getCalendarDateKey(instant, 'Africa/Cairo')).toBe('2026-11-01');

      // Requirement alias 'Asia/Cairo' normalizes to Africa/Cairo
      expect(getCalendarDateKey(instant, 'Asia/Cairo')).toBe('2026-11-01');

      // New York (UTC-4 in daylight time) is 19:30 on Oct 31
      expect(getCalendarDateKey(instant, 'America/New_York')).toBe('2026-10-31');

      // Tokyo (UTC+9) is 08:30 on Nov 1
      expect(getCalendarDateKey(instant, 'Asia/Tokyo')).toBe('2026-11-01');

      // Honolulu (UTC-10) is 13:30 on Oct 31
      expect(getCalendarDateKey(instant, 'Pacific/Honolulu')).toBe('2026-10-31');
    });

    it('handles negative timezone offset boundaries where UTC date and local date differ', () => {
      // 2026-05-01T02:00:00Z
      const instant = '2026-05-01T02:00:00.000Z';

      // UTC is May 1, 2026
      expect(getCalendarDateKey(instant, 'UTC')).toBe('2026-05-01');

      // Los Angeles (UTC-7 in summer) is April 30, 2026 at 19:00
      expect(getCalendarDateKey(instant, 'America/Los_Angeles')).toBe('2026-04-30');
    });

    it('rejects invalid dates and invalid timezones', () => {
      expect(() => getCalendarDateKey('not-a-valid-date')).toThrow(/Invalid date/);
      expect(() => getCalendarDateKey('2026-10-29T12:00:00Z', 'Invalid/Timezone')).toThrow(
        /Invalid timezone/
      );
    });

    it('defaults safely to Africa/Cairo when timezone is empty or omitted', () => {
      const instant = '2026-10-31T23:30:00.000Z';
      expect(getCalendarDateKey(instant)).toBe('2026-11-01');
      expect(getCalendarDateKey(instant, '')).toBe('2026-11-01');
    });
  });

  describe('getWeekRange (Monday to Sunday)', () => {
    it('calculates a complete Monday-to-Sunday week containing a Wednesday reference date', () => {
      // Wednesday Oct 28, 2026
      const week = getWeekRange('2026-10-28T14:00:00Z', 'Africa/Cairo');

      expect(week.days).toHaveLength(7);
      expect(week.days[0].weekday).toBe(1);
      expect(week.days[0].weekdayName).toBe('Mon');
      expect(week.days[0].dateKey).toBe('2026-10-26');

      expect(week.days[6].weekday).toBe(7);
      expect(week.days[6].weekdayName).toBe('Sun');
      expect(week.days[6].dateKey).toBe('2026-11-01');

      expect(week.label).toBe('Oct 26 – Nov 1, 2026');
    });

    it('returns the exact same week whether the reference date is Monday, Sunday, or mid-week', () => {
      const tz = 'Africa/Cairo';
      // Monday Oct 26, 2026
      const fromMonday = getWeekRange('2026-10-26T08:00:00Z', tz);
      // Thursday Oct 29, 2026
      const fromThursday = getWeekRange('2026-10-29T16:00:00Z', tz);
      // Sunday Nov 1, 2026
      const fromSunday = getWeekRange('2026-11-01T20:00:00Z', tz);

      expect(fromMonday.days.map((d) => d.dateKey)).toEqual(
        fromThursday.days.map((d) => d.dateKey)
      );
      expect(fromSunday.days.map((d) => d.dateKey)).toEqual(
        fromThursday.days.map((d) => d.dateKey)
      );
      expect(fromMonday.weekStartIso).toBe(fromSunday.weekStartIso);
      expect(fromMonday.weekEndIso).toBe(fromSunday.weekEndIso);
    });

    it('correctly handles week crossing a year boundary (December to January)', () => {
      // Thursday Dec 31, 2026 in UTC
      const week = getWeekRange('2026-12-31T12:00:00Z', 'UTC');

      expect(week.days).toHaveLength(7);
      expect(week.days[0].dateKey).toBe('2026-12-28'); // Monday
      expect(week.days[0].weekday).toBe(1);
      expect(week.days[3].dateKey).toBe('2026-12-31'); // Thursday
      expect(week.days[4].dateKey).toBe('2027-01-01'); // Friday
      expect(week.days[6].dateKey).toBe('2027-01-03'); // Sunday

      expect(week.label).toBe('Dec 28, 2026 – Jan 3, 2027');
    });

    it('formats single-month week labels compactly', () => {
      // Wednesday Nov 4, 2026 in UTC
      const week = getWeekRange('2026-11-04T12:00:00Z', 'UTC');
      expect(week.label).toBe('Nov 2 – 8, 2026');
    });

    it('navigates to next and previous weeks deterministically', () => {
      const tz = 'Africa/Cairo';
      const baseWeek = getWeekRange('2026-10-28T12:00:00Z', tz);
      expect(baseWeek.label).toBe('Oct 26 – Nov 1, 2026');

      const nextWeek = getNextWeekRange(baseWeek.weekStart, tz);
      expect(nextWeek.label).toBe('Nov 2 – 8, 2026');
      expect(nextWeek.days[0].dateKey).toBe('2026-11-02');
      expect(nextWeek.days[6].dateKey).toBe('2026-11-08');

      const prevWeek = getPrevWeekRange(baseWeek.weekStart, tz);
      expect(prevWeek.label).toBe('Oct 19 – 25, 2026');
      expect(prevWeek.days[0].dateKey).toBe('2026-10-19');
      expect(prevWeek.days[6].dateKey).toBe('2026-10-25');
    });

    it('rejects invalid inputs', () => {
      expect(() => getWeekRange('invalid-ref-date')).toThrow(/Invalid date/);
      expect(() => getWeekRange('2026-10-28', 'Invalid/Zone')).toThrow(/Invalid timezone/);
    });
  });

  describe('getMonthRange', () => {
    it('calculates the 1st day 00:00:00 to last day 23:59:59.999 for October in Cairo', () => {
      const month = getMonthRange('2026-10-15T12:00:00Z', 'Africa/Cairo');

      expect(month.year).toBe(2026);
      expect(month.month).toBe(10);
      expect(month.totalDays).toBe(31);
      expect(month.label).toBe('October 2026');

      // Format start and end in Cairo to verify local wall-clock boundaries
      const startParts = getLocalParts(month.monthStart, 'Africa/Cairo');
      expect(startParts.year).toBe(2026);
      expect(startParts.month).toBe(10);
      expect(startParts.day).toBe(1);
      expect(startParts.hour).toBe(0);
      expect(startParts.minute).toBe(0);

      const endParts = getLocalParts(month.monthEnd, 'Africa/Cairo');
      expect(endParts.year).toBe(2026);
      expect(endParts.month).toBe(10);
      expect(endParts.day).toBe(31);
      expect(endParts.hour).toBe(23);
      expect(endParts.minute).toBe(59);
      expect(endParts.second).toBe(59);
    });

    it('accounts for leap years in February', () => {
      // Leap year 2024
      const leapFeb = getMonthRange('2024-02-10T12:00:00Z', 'UTC');
      expect(leapFeb.totalDays).toBe(29);

      // Non-leap year 2026
      const standardFeb = getMonthRange('2026-02-10T12:00:00Z', 'UTC');
      expect(standardFeb.totalDays).toBe(28);
    });
  });

  describe('getMonthGrid (Monday-start grid with leading/trailing cells)', () => {
    it('generates a 6-row grid for March 2026 which starts on Sunday', () => {
      // March 1, 2026 is Sunday (31 days).
      // Monday-start grid requires 6 leading days (Feb 23-28) + 31 March days = 37 days.
      // Must span 6 rows (42 cells) with 5 trailing days (Apr 1-5).
      const grid = getMonthGrid('2026-03-15T12:00:00Z', 'UTC');

      expect(grid.year).toBe(2026);
      expect(grid.month).toBe(3);
      expect(grid.label).toBe('March 2026');
      expect(grid.totalRows).toBe(6);
      expect(grid.totalCells).toBe(42);
      expect(grid.cells).toHaveLength(42);

      // First cell: Monday Feb 23, 2026 (Leading)
      expect(grid.cells[0].dateKey).toBe('2026-02-23');
      expect(grid.cells[0].weekday).toBe(1);
      expect(grid.cells[0].weekdayName).toBe('Mon');
      expect(grid.cells[0].isLeading).toBe(true);
      expect(grid.cells[0].isCurrentMonth).toBe(false);

      // Last leading cell: Saturday Feb 28, 2026
      expect(grid.cells[5].dateKey).toBe('2026-02-28');
      expect(grid.cells[5].isLeading).toBe(true);

      // First day of current month: Sunday March 1, 2026
      expect(grid.cells[6].dateKey).toBe('2026-03-01');
      expect(grid.cells[6].weekday).toBe(7);
      expect(grid.cells[6].isLeading).toBe(false);
      expect(grid.cells[6].isCurrentMonth).toBe(true);

      // Last day of current month: Tuesday March 31, 2026
      expect(grid.cells[36].dateKey).toBe('2026-03-31');
      expect(grid.cells[36].isCurrentMonth).toBe(true);
      expect(grid.cells[36].isTrailing).toBe(false);

      // First trailing cell: Wednesday April 1, 2026
      expect(grid.cells[37].dateKey).toBe('2026-04-01');
      expect(grid.cells[37].isTrailing).toBe(true);
      expect(grid.cells[37].isCurrentMonth).toBe(false);

      // Last cell of grid: Sunday April 5, 2026
      expect(grid.cells[41].dateKey).toBe('2026-04-05');
      expect(grid.cells[41].weekday).toBe(7);
      expect(grid.cells[41].isTrailing).toBe(true);
    });

    it('generates a 5-row grid for June 2026 which starts on Monday', () => {
      // June 1, 2026 is Monday (30 days).
      // 0 leading days + 30 days = 30 days -> 5 rows (35 cells) with 5 trailing days (July 1-5).
      const grid = getMonthGrid('2026-06-10T12:00:00Z', 'UTC');

      expect(grid.totalRows).toBe(5);
      expect(grid.totalCells).toBe(35);

      // First cell is June 1 (no leading cells)
      expect(grid.cells[0].dateKey).toBe('2026-06-01');
      expect(grid.cells[0].isLeading).toBe(false);
      expect(grid.cells[0].isCurrentMonth).toBe(true);

      // Trailing cells start on July 1
      expect(grid.cells[30].dateKey).toBe('2026-07-01');
      expect(grid.cells[30].isTrailing).toBe(true);
      expect(grid.cells[34].dateKey).toBe('2026-07-05');
    });

    it('handles December to January transition in the monthly grid', () => {
      // December 2026 starts on Tuesday (1 leading day: Nov 30)
      // Ends on Thursday Dec 31 (3 trailing days: Jan 1, 2, 3 of 2027)
      const grid = getMonthGrid('2026-12-15T12:00:00Z', 'UTC');

      expect(grid.totalRows).toBe(5);
      expect(grid.totalCells).toBe(35);
      expect(grid.cells[0].dateKey).toBe('2026-11-30');
      expect(grid.cells[0].isLeading).toBe(true);

      expect(grid.cells[32].dateKey).toBe('2027-01-01');
      expect(grid.cells[32].year).toBe(2027);
      expect(grid.cells[32].month).toBe(1);
      expect(grid.cells[32].day).toBe(1);
      expect(grid.cells[32].isTrailing).toBe(true);

      expect(grid.cells[34].dateKey).toBe('2027-01-03');
      expect(grid.cells[34].year).toBe(2027);
    });
  });

  describe('Daylight Saving Time (DST) Stability', () => {
    it('maintains day stability across US Spring-Forward DST transition (March 8, 2026)', () => {
      // Clocks move forward from 02:00 to 03:00 in America/New_York (23-hour day)
      const tz = 'America/New_York';
      const week = getWeekRange('2026-03-08T16:00:00Z', tz);

      expect(week.days).toHaveLength(7);
      const expectedKeys = [
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
        '2026-03-06',
        '2026-03-07',
        '2026-03-08',
      ];
      expect(week.days.map((d) => d.dateKey)).toEqual(expectedKeys);

      // Verify that startOfDay and endOfDay in New York map strictly to 00:00 and 23:59
      const sunday = week.days[6];
      expect(sunday.dateKey).toBe('2026-03-08');
      const startParts = getLocalParts(sunday.startOfDay, tz);
      expect(startParts.day).toBe(8);
      expect(startParts.hour).toBe(0);

      const endParts = getLocalParts(sunday.endOfDay, tz);
      expect(endParts.day).toBe(8);
      expect(endParts.hour).toBe(23);
      expect(endParts.minute).toBe(59);
    });

    it('maintains day stability across US Fall-Back DST transition (November 1, 2026)', () => {
      // Clocks move back from 02:00 to 01:00 in America/New_York (25-hour day)
      const tz = 'America/New_York';
      const week = getWeekRange('2026-11-01T16:00:00Z', tz);

      expect(week.days).toHaveLength(7);
      const expectedKeys = [
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
      ];
      expect(week.days.map((d) => d.dateKey)).toEqual(expectedKeys);

      const sunday = week.days[6];
      expect(sunday.dateKey).toBe('2026-11-01');
      const startParts = getLocalParts(sunday.startOfDay, tz);
      expect(startParts.day).toBe(1);
      expect(startParts.hour).toBe(0);

      const endParts = getLocalParts(sunday.endOfDay, tz);
      expect(endParts.day).toBe(1);
      expect(endParts.hour).toBe(23);
      expect(endParts.minute).toBe(59);
    });

    it('maintains day stability across Egypt DST transition', () => {
      const tz = 'Africa/Cairo';
      // In Cairo, DST transitions in late April and late October
      const springWeek = getWeekRange('2026-04-24T12:00:00Z', tz);
      expect(springWeek.days.map((d) => d.dateKey)).toEqual([
        '2026-04-20',
        '2026-04-21',
        '2026-04-22',
        '2026-04-23',
        '2026-04-24',
        '2026-04-25',
        '2026-04-26',
      ]);
    });
  });

  describe('Formatting Utilities', () => {
    it('formats month labels from numbers and dates', () => {
      expect(formatMonthLabel(2026, 1)).toBe('January 2026');
      expect(formatMonthLabel(2026, 10)).toBe('October 2026');
      expect(formatMonthLabel(2026, 12)).toBe('December 2026');

      expect(formatMonthLabel('2026-05-15T12:00:00Z', 'UTC')).toBe('May 2026');
      expect(formatMonthLabel(new Date('2026-08-20T12:00:00Z'), 'Africa/Cairo')).toBe(
        'August 2026'
      );
    });

    it('formats week labels correctly across same-month, different-month, and different-year ranges', () => {
      // Same month
      expect(
        formatWeekLabel('2026-11-02T00:00:00Z', '2026-11-08T23:59:59Z', 'UTC')
      ).toBe('Nov 2 – 8, 2026');

      // Different month, same year
      expect(
        formatWeekLabel('2026-10-26T00:00:00Z', '2026-11-01T23:59:59Z', 'UTC')
      ).toBe('Oct 26 – Nov 1, 2026');

      // Different year
      expect(
        formatWeekLabel('2026-12-28T00:00:00Z', '2027-01-03T23:59:59Z', 'UTC')
      ).toBe('Dec 28, 2026 – Jan 3, 2027');
    });
  });

  describe('Helper Utilities', () => {
    it('returns accurate days in month for standard and leap years', () => {
      expect(getDaysInMonth(2026, 1)).toBe(31);
      expect(getDaysInMonth(2026, 2)).toBe(28);
      expect(getDaysInMonth(2024, 2)).toBe(29); // Leap year
      expect(getDaysInMonth(2026, 4)).toBe(30);
    });

    it('creates exact UTC dates from local wall-clock components', () => {
      const utc = createUtcFromLocal(2026, 10, 29, 14, 30, 0, 0, 'UTC');
      expect(utc.toISOString()).toBe('2026-10-29T14:30:00.000Z');

      const cairoUtc = createUtcFromLocal(2026, 1, 15, 14, 0, 0, 0, 'Africa/Cairo');
      // Cairo in January is UTC+2, so 14:00 Cairo is 12:00 UTC
      expect(cairoUtc.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    });

    it('calculates DayRange with exact boundaries in the specified timezone', () => {
      const dayRange = getDayRange('2026-10-29T12:00:00Z', 'UTC');
      expect(dayRange.dateKey).toBe('2026-10-29');
      expect(dayRange.dayStartIso).toBe('2026-10-29T00:00:00.000Z');
      expect(dayRange.dayEndIso).toBe('2026-10-29T23:59:59.999Z');
      expect(dayRange.label).toContain('Oct 29, 2026');
    });

    it('navigates next and previous days across month and year boundaries', () => {
      const novDate = new Date('2026-11-01T12:00:00Z');
      const prevDay = getPrevDayDate(novDate, 'UTC');
      expect(getCalendarDateKey(prevDay, 'UTC')).toBe('2026-10-31');

      const nextDay = getNextDayDate(prevDay, 'UTC');
      expect(getCalendarDateKey(nextDay, 'UTC')).toBe('2026-11-01');

      const newYearEve = new Date('2026-12-31T12:00:00Z');
      const newYearDay = getNextDayDate(newYearEve, 'UTC');
      expect(getCalendarDateKey(newYearDay, 'UTC')).toBe('2027-01-01');
    });

    it('formats and parses local HTML datetime-local strings deterministically in timezone', () => {
      // In Cairo winter (UTC+2): 2026-01-15T10:30:00Z is 12:30 local
      const localStr = toLocalDatetimeString('2026-01-15T10:30:00.000Z', 'Africa/Cairo');
      expect(localStr).toBe('2026-01-15T12:30');

      // Parsing local 12:30 in Cairo should produce 10:30 UTC
      const parsedUtc = parseLocalDatetimeString('2026-01-15T12:30', 'Africa/Cairo');
      expect(parsedUtc?.toISOString()).toBe('2026-01-15T10:30:00.000Z');
    });

    it('extracts item hour and minute in target timezone', () => {
      // 14:45 UTC is 16:45 in Cairo winter (UTC+2)
      const { hour, minute } = getItemHourInTimeZone('2026-01-15T14:45:00Z', 'Africa/Cairo');
      expect(hour).toBe(16);
      expect(minute).toBe(45);
    });
  });
});
