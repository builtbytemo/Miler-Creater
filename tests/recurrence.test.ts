import { describe, it, expect } from 'vitest';
import {
  calculateNextOccurrence,
  generateOccurrencesInRange,
  type RecurrenceRuleParams,
} from '../src/lib/temporal/recurrence';
import { formatInTimeZone } from '../src/lib/temporal/timezone';

describe('Recurrence Engine Specification & Edge Cases', () => {
  const cairoTz = 'Africa/Cairo';

  describe('Daily Recurrence', () => {
    it('advances by 1 day at the exact same local time', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        timezone: cairoTz,
      };

      const start = new Date('2026-11-01T07:00:00Z'); // 09:00 AM Cairo in Winter (UTC+2)
      const next = calculateNextOccurrence(rule, start);

      expect(next).not.toBeNull();
      // Should be 2026-11-02T07:00:00Z
      expect(next?.toISOString()).toBe('2026-11-02T07:00:00.000Z');
      expect(formatInTimeZone(next!, cairoTz)).toContain('09:00 AM');
      expect(formatInTimeZone(next!, cairoTz)).toContain('Nov 02, 2026');
    });

    it('advances by interval days (every 3 days)', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 3,
        timezone: cairoTz,
      };

      const start = new Date('2026-11-01T07:00:00Z');
      const next = calculateNextOccurrence(rule, start);

      expect(next?.toISOString()).toBe('2026-11-04T07:00:00.000Z');
    });
  });

  describe('Weekly Recurrence with by_weekday', () => {
    it('cycles sequentially through specified weekdays (Mon, Wed, Fri)', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1, 3, 5], // Monday (1), Wednesday (3), Friday (5)
        timezone: cairoTz,
      };

      // Monday, Nov 2, 2026 at 09:00 AM Cairo
      const monday = new Date('2026-11-02T07:00:00Z');
      const wednesday = calculateNextOccurrence(rule, monday);
      expect(wednesday?.toISOString()).toBe('2026-11-04T07:00:00.000Z'); // Nov 4 is Wednesday

      const friday = calculateNextOccurrence(rule, wednesday!);
      expect(friday?.toISOString()).toBe('2026-11-06T07:00:00.000Z'); // Nov 6 is Friday

      // From Friday, next should wrap to next week's Monday
      const nextMonday = calculateNextOccurrence(rule, friday!);
      expect(nextMonday?.toISOString()).toBe('2026-11-09T07:00:00.000Z'); // Nov 9 is Monday
    });
  });

  describe('Monthly Recurrence & Month Boundary Clamping', () => {
    it('advances to the exact same day of next month', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [15],
        timezone: cairoTz,
      };

      const jan15 = new Date('2026-01-15T08:00:00Z');
      const feb15 = calculateNextOccurrence(rule, jan15);

      expect(feb15).not.toBeNull();
      expect(formatInTimeZone(feb15!, cairoTz)).toContain('Feb 15, 2026');
    });

    it('clamps 31st to 28th in February (non-leap year edge case)', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [31],
        timezone: cairoTz,
      };

      // Jan 31, 2026
      const jan31 = new Date('2026-01-31T08:00:00Z');
      const febResult = calculateNextOccurrence(rule, jan31);

      expect(febResult).not.toBeNull();
      // February in 2026 has 28 days -> must clamp to Feb 28, not overflow to March!
      expect(formatInTimeZone(febResult!, cairoTz)).toContain('Feb 28, 2026');
    });

    it('clamps 31st to 30th in 30-day months (e.g. April)', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [31],
        timezone: cairoTz,
      };

      // March 31, 2026
      const mar31 = new Date('2026-03-31T08:00:00Z');
      const aprResult = calculateNextOccurrence(rule, mar31);

      expect(aprResult).not.toBeNull();
      expect(formatInTimeZone(aprResult!, cairoTz)).toContain('Apr 30, 2026');
    });
  });

  describe('Daylight Saving Time (DST) Transition Stability', () => {
    it('maintains local 09:00 AM Cairo wall-clock time across DST transitions', () => {
      // In Egypt:
      // In April 2026, clocks spring forward from UTC+2 to UTC+3 (Daylight Time)
      // A daily task at 09:00 AM Cairo time before DST:
      // Local 09:00 AM = 07:00 UTC (when offset is +2)
      // Local 09:00 AM = 06:00 UTC (when offset is +3)
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        timezone: cairoTz,
      };

      // Reference date in standard winter time (January)
      const winterDate = new Date('2026-01-15T07:00:00Z'); // 09:00 AM Cairo (UTC+2)
      expect(formatInTimeZone(winterDate, cairoTz)).toContain('09:00 AM');

      // Reference date in summer daylight saving time (July)
      const summerDate = new Date('2026-07-15T06:00:00Z'); // 09:00 AM Cairo (UTC+3)
      expect(formatInTimeZone(summerDate, cairoTz)).toContain('09:00 AM');

      // When calculating next day in summer:
      const nextSummer = calculateNextOccurrence(rule, summerDate);
      expect(nextSummer).not.toBeNull();
      // Must maintain 09:00 AM Cairo local display time
      expect(formatInTimeZone(nextSummer!, cairoTz)).toContain('09:00 AM');
      expect(formatInTimeZone(nextSummer!, cairoTz)).toContain('Jul 16, 2026');
      expect(nextSummer?.toISOString()).toBe('2026-07-16T06:00:00.000Z');
    });
  });

  describe('Range Projection & End Conditions', () => {
    it('generates occurrences strictly within range window', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 2, // Every 2 days
        timezone: cairoTz,
      };

      const initialStart = '2026-11-01T07:00:00Z';
      const rangeStart = '2026-11-05T00:00:00Z';
      const rangeEnd = '2026-11-10T23:59:59Z';

      const occurrences = generateOccurrencesInRange(rule, initialStart, rangeStart, rangeEnd);

      // Sequence: Nov 1, Nov 3, Nov 5 (in range), Nov 7 (in range), Nov 9 (in range), Nov 11 (out)
      expect(occurrences.length).toBe(3);
      expect(formatInTimeZone(occurrences[0], cairoTz)).toContain('Nov 05, 2026');
      expect(formatInTimeZone(occurrences[1], cairoTz)).toContain('Nov 07, 2026');
      expect(formatInTimeZone(occurrences[2], cairoTz)).toContain('Nov 09, 2026');
    });

    it('terminates occurrence generation after until_date', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        until_date: '2026-11-03T12:00:00Z',
        timezone: cairoTz,
      };

      const day1 = new Date('2026-11-01T07:00:00Z');
      const day2 = calculateNextOccurrence(rule, day1);
      expect(day2).not.toBeNull();

      const day3 = calculateNextOccurrence(rule, day2!);
      expect(day3).not.toBeNull();

      // day4 would be Nov 4, which is after until_date Nov 3 -> must return null
      const day4 = calculateNextOccurrence(rule, day3!);
      expect(day4).toBeNull();
    });
  });
});
