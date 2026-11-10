import { describe, it, expect } from 'vitest';
import {
  calculateNextOccurrence,
  calculateNextUpcomingSlot,
  generateOccurrencesInRange,
  projectOccurrencesInRange,
  validateRecurrenceRule,
  type RecurrenceRuleParams,
} from '../src/lib/temporal/recurrence';
import { formatInTimeZone } from '../src/lib/temporal/timezone';

describe('Recurrence Engine Specification & Edge Cases', () => {
  const cairoTz = 'Africa/Cairo';
  const cairoAlias = 'Asia/Cairo';
  const nyTz = 'America/New_York';

  describe('1. Daily Recurrence & Positive Intervals', () => {
    it('advances by 1 day at the exact same local time', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        timezone: cairoTz,
      };

      const start = new Date('2026-11-01T07:00:00Z'); // 09:00 AM Cairo in Winter (UTC+2)
      const next = calculateNextOccurrence(rule, start);

      expect(next).not.toBeNull();
      expect(next?.toISOString()).toBe('2026-11-02T07:00:00.000Z');
      expect(formatInTimeZone(next!, cairoTz)).toContain('09:00 AM');
      expect(formatInTimeZone(next!, cairoTz)).toContain('Nov 02, 2026');
    });

    it('advances by arbitrary positive intervals (every 3, 7, and 14 days)', () => {
      const rule3: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 3,
        timezone: cairoTz,
      };
      const start = new Date('2026-11-01T07:00:00Z');
      expect(calculateNextOccurrence(rule3, start)?.toISOString()).toBe('2026-11-04T07:00:00.000Z');

      const rule7: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 7,
        timezone: cairoTz,
      };
      expect(calculateNextOccurrence(rule7, start)?.toISOString()).toBe('2026-11-08T07:00:00.000Z');

      const rule14: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 14,
        timezone: cairoTz,
      };
      expect(calculateNextOccurrence(rule14, start)?.toISOString()).toBe('2026-11-15T07:00:00.000Z');
    });
  });

  describe('2. Weekly Recurrence & Multi-Weekday Intervals', () => {
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

    it('handles bi-weekly recurrence (interval = 2) across week boundaries', () => {
      // Anchored on Tuesday Nov 3, 2026; repeats every 2 weeks on Tuesday (2) and Thursday (4)
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 2,
        by_weekday: [2, 4],
        timezone: cairoTz,
        dtstart: '2026-11-03T07:00:00Z',
      };

      // Week 1: Tuesday Nov 3
      const tue1 = new Date('2026-11-03T07:00:00Z');
      const thu1 = calculateNextOccurrence(rule, tue1);
      // Same week Thursday (Nov 5)
      expect(thu1?.toISOString()).toBe('2026-11-05T07:00:00.000Z');
      expect(formatInTimeZone(thu1!, cairoTz)).toContain('Nov 05, 2026');

      // From Thursday Nov 5: Skips week 2 (Nov 9-15) and jumps to Tuesday Nov 17 in Week 3
      const tue2 = calculateNextOccurrence(rule, thu1!);
      expect(tue2?.toISOString()).toBe('2026-11-17T07:00:00.000Z');
      expect(formatInTimeZone(tue2!, cairoTz)).toContain('Nov 17, 2026');

      // Then Thursday in Week 3 (Nov 19)
      const thu2 = calculateNextOccurrence(rule, tue2!);
      expect(thu2?.toISOString()).toBe('2026-11-19T07:00:00.000Z');
    });

    it('correctly handles non-consecutive multi-weekday sequences with interval = 3', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 3,
        by_weekday: [1, 5], // Monday & Friday
        timezone: cairoTz,
        dtstart: '2026-11-02T07:00:00Z', // Monday Nov 2 (Week 0)
      };

      const mon1 = new Date('2026-11-02T07:00:00Z');
      const fri1 = calculateNextOccurrence(rule, mon1);
      expect(fri1?.toISOString()).toBe('2026-11-06T07:00:00.000Z');

      // Skips 2 weeks (Nov 9-15, Nov 16-22) and jumps to Monday Nov 23
      const mon2 = calculateNextOccurrence(rule, fri1!);
      expect(mon2?.toISOString()).toBe('2026-11-23T07:00:00.000Z');
    });
  });

  describe('3. Monthly Recurrence & Non-Drifting Clamping', () => {
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

    it('clamps 31st to 28th in February and RESTORES to 31st in March (zero drift)', () => {
      // Anchored to January 31, 2026
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [31],
        timezone: cairoTz,
        dtstart: '2026-01-31T07:00:00Z',
      };

      // 1. Jan 31 -> Feb 28 (February has 28 days in 2026)
      const jan31 = new Date('2026-01-31T07:00:00Z');
      const febResult = calculateNextOccurrence(rule, jan31);
      expect(febResult).not.toBeNull();
      expect(formatInTimeZone(febResult!, cairoTz)).toContain('Feb 28, 2026');

      // 2. Feb 28 -> March 31! (MUST restore to 31, not stay stuck on 28)
      const marResult = calculateNextOccurrence(rule, febResult!);
      expect(marResult).not.toBeNull();
      expect(formatInTimeZone(marResult!, cairoTz)).toContain('Mar 31, 2026');

      // 3. March 31 -> April 30 (30 days in April)
      const aprResult = calculateNextOccurrence(rule, marResult!);
      expect(aprResult).not.toBeNull();
      expect(formatInTimeZone(aprResult!, cairoTz)).toContain('Apr 30, 2026');

      // 4. April 30 -> May 31 (MUST restore to 31)
      const mayResult = calculateNextOccurrence(rule, aprResult!);
      expect(mayResult).not.toBeNull();
      expect(formatInTimeZone(mayResult!, cairoTz)).toContain('May 31, 2026');
    });

    it('preserves anchor day even if by_monthday was omitted when dtstart is provided', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        timezone: cairoTz,
        dtstart: '2026-01-31T07:00:00Z', // Anchor is 31st
      };

      const jan31 = new Date('2026-01-31T07:00:00Z');
      const feb = calculateNextOccurrence(rule, jan31);
      expect(formatInTimeZone(feb!, cairoTz)).toContain('Feb 28, 2026');

      const mar = calculateNextOccurrence(rule, feb!);
      expect(formatInTimeZone(mar!, cairoTz)).toContain('Mar 31, 2026');
    });

    it('supports multiple month days (e.g. 1st and 15th of every month)', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [1, 15],
        timezone: cairoTz,
      };

      const jan01 = new Date('2026-01-01T07:00:00Z');
      const jan15 = calculateNextOccurrence(rule, jan01);
      expect(formatInTimeZone(jan15!, cairoTz)).toContain('Jan 15, 2026');

      const feb01 = calculateNextOccurrence(rule, jan15!);
      expect(formatInTimeZone(feb01!, cairoTz)).toContain('Feb 01, 2026');
    });
  });

  describe('4. Genuine Yearly Recurrence & Leap-Year Semantics', () => {
    it('advances by interval years at the exact local time', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'yearly',
        interval: 1,
        timezone: cairoTz,
      };

      const start = new Date('2026-11-10T07:00:00Z'); // Nov 10, 2026 09:00 AM Cairo
      const next = calculateNextOccurrence(rule, start);

      expect(next).not.toBeNull();
      expect(next?.toISOString()).toBe('2027-11-10T07:00:00.000Z');
      expect(formatInTimeZone(next!, cairoTz)).toContain('Nov 10, 2027');
      expect(formatInTimeZone(next!, cairoTz)).toContain('09:00 AM');
    });

    it('advances by multi-year interval (interval = 2)', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'yearly',
        interval: 2,
        timezone: cairoTz,
      };

      const start = new Date('2026-06-15T06:00:00Z'); // Summer (UTC+3)
      const next = calculateNextOccurrence(rule, start);

      expect(next).not.toBeNull();
      expect(formatInTimeZone(next!, cairoTz)).toContain('Jun 15, 2028');
    });

    it('handles leap year anchor (Feb 29): clamps to Feb 28 on non-leap years and restores Feb 29 on next leap year', () => {
      // Leap year anchor: Feb 29, 2024
      const rule: RecurrenceRuleParams = {
        frequency: 'yearly',
        interval: 1,
        by_monthday: [29],
        timezone: cairoTz,
        dtstart: '2024-02-29T07:00:00Z',
      };

      const feb29_2024 = new Date('2024-02-29T07:00:00Z');

      // 2025: Non-leap year -> clamps to Feb 28
      const occ2025 = calculateNextOccurrence(rule, feb29_2024);
      expect(formatInTimeZone(occ2025!, cairoTz)).toContain('Feb 28, 2025');

      // 2026: Non-leap year -> clamps to Feb 28
      const occ2026 = calculateNextOccurrence(rule, occ2025!);
      expect(formatInTimeZone(occ2026!, cairoTz)).toContain('Feb 28, 2026');

      // 2027: Non-leap year -> clamps to Feb 28
      const occ2027 = calculateNextOccurrence(rule, occ2026!);
      expect(formatInTimeZone(occ2027!, cairoTz)).toContain('Feb 28, 2027');

      // 2028: LEAP YEAR -> MUST restore to Feb 29!
      const occ2028 = calculateNextOccurrence(rule, occ2027!);
      expect(formatInTimeZone(occ2028!, cairoTz)).toContain('Feb 29, 2028');
    });
  });

  describe('5. Unsupported Frequency & Explicit Validation Rejection', () => {
    it('throws explicit error when frequency is custom', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'custom',
        interval: 1,
      };

      expect(() => calculateNextOccurrence(rule, new Date())).toThrow(
        /Unsupported recurrence frequency: 'custom'/
      );
    });

    it('throws explicit error when frequency is an unknown string', () => {
      const rule = {
        frequency: 'hourly',
        interval: 1,
      } as unknown as RecurrenceRuleParams;

      expect(() => calculateNextOccurrence(rule, new Date())).toThrow(
        /Unsupported recurrence frequency: 'hourly'/
      );
    });

    it('validates recurrence rule parameters rigorously', () => {
      // Non-positive interval
      expect(() => validateRecurrenceRule({ frequency: 'daily', interval: 0 })).toThrow(/Interval must be a positive integer/);
      expect(() => validateRecurrenceRule({ frequency: 'daily', interval: -5 })).toThrow(/Interval must be a positive integer/);
      expect(() => validateRecurrenceRule({ frequency: 'daily', interval: 1.5 })).toThrow(/Interval must be a positive integer/);

      // Invalid weekdays
      expect(() => validateRecurrenceRule({ frequency: 'weekly', interval: 1, by_weekday: [0] })).toThrow(/between 1/);
      expect(() => validateRecurrenceRule({ frequency: 'weekly', interval: 1, by_weekday: [8] })).toThrow(/between 1/);
      expect(() => validateRecurrenceRule({ frequency: 'weekly', interval: 1, by_weekday: [1, 1] })).toThrow(/duplicate days/);
      expect(() => validateRecurrenceRule({ frequency: 'weekly', interval: 1, by_weekday: [] })).toThrow(/non-empty/);

      // Invalid monthdays
      expect(() => validateRecurrenceRule({ frequency: 'monthly', interval: 1, by_monthday: [0] })).toThrow(/between 1 and 31/);
      expect(() => validateRecurrenceRule({ frequency: 'monthly', interval: 1, by_monthday: [32] })).toThrow(/between 1 and 31/);
      expect(() => validateRecurrenceRule({ frequency: 'monthly', interval: 1, by_monthday: [15, 15] })).toThrow(/duplicate days/);

      // Mutually exclusive termination conditions
      expect(() => validateRecurrenceRule({
        frequency: 'daily',
        interval: 1,
        until_date: '2026-12-31T00:00:00Z',
        count: 10,
      })).toThrow(/Cannot specify both until_date and count/);

      // Invalid count
      expect(() => validateRecurrenceRule({ frequency: 'daily', interval: 1, count: 0 })).toThrow(/count must be a positive integer/);
      expect(() => validateRecurrenceRule({ frequency: 'daily', interval: 1, count: -1 })).toThrow(/count must be a positive integer/);

      // Invalid timezone
      expect(() => validateRecurrenceRule({ frequency: 'daily', interval: 1, timezone: 'Mars/Phobos' })).toThrow(/Invalid IANA timezone identifier/);
    });
  });

  describe('6. Daylight Saving Time (DST) Transition Stability', () => {
    it('maintains local 09:00 AM Cairo wall-clock time across summer DST transitions', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        timezone: cairoAlias, // Asia/Cairo alias normalized transparently
      };

      // Reference date in standard winter time (January: UTC+2)
      const winterDate = new Date('2026-01-15T07:00:00Z'); // 09:00 AM Cairo
      expect(formatInTimeZone(winterDate, cairoTz)).toContain('09:00 AM');

      // Reference date in summer daylight saving time (July: UTC+3)
      const summerDate = new Date('2026-07-15T06:00:00Z'); // 09:00 AM Cairo
      expect(formatInTimeZone(summerDate, cairoTz)).toContain('09:00 AM');

      const nextSummer = calculateNextOccurrence(rule, summerDate);
      expect(nextSummer).not.toBeNull();
      expect(formatInTimeZone(nextSummer!, cairoTz)).toContain('09:00 AM');
      expect(formatInTimeZone(nextSummer!, cairoTz)).toContain('Jul 16, 2026');
      expect(nextSummer?.toISOString()).toBe('2026-07-16T06:00:00.000Z');
    });

    it('maintains local wall-clock time across US Eastern Time (New York) DST shifts', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        timezone: nyTz,
      };

      // In NY: Clocks spring forward on March 8, 2026 (from UTC-5 EST to UTC-4 EDT)
      // March 7, 2026 at 10:00 AM NY (EST, UTC-5) -> 15:00:00Z
      const beforeDst = new Date('2026-03-07T15:00:00Z');
      expect(formatInTimeZone(beforeDst, nyTz)).toContain('10:00 AM');

      // March 8, 2026 at 10:00 AM NY (EDT, UTC-4) -> 14:00:00Z
      const afterDst = calculateNextOccurrence(rule, beforeDst);
      expect(afterDst).not.toBeNull();
      expect(afterDst?.toISOString()).toBe('2026-03-08T14:00:00.000Z');
      expect(formatInTimeZone(afterDst!, nyTz)).toContain('10:00 AM');
    });
  });

  describe('7. Termination Boundaries: until_date and count Limit', () => {
    it('terminates occurrence generation after until_date date-only string (end-of-day inclusive)', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        until_date: '2026-11-03', // Date-only: includes full day of Nov 3
        timezone: cairoTz,
      };

      const day1 = new Date('2026-11-01T07:00:00Z'); // 09:00 AM Nov 1
      const day2 = calculateNextOccurrence(rule, day1);
      expect(day2).not.toBeNull();

      const day3 = calculateNextOccurrence(rule, day2!);
      expect(day3).not.toBeNull(); // 09:00 AM Nov 3 is included

      // Day 4 would be Nov 4, which is strictly after Nov 3 end-of-day -> returns null
      const day4 = calculateNextOccurrence(rule, day3!);
      expect(day4).toBeNull();
    });

    it('terminates occurrence generation when count limit is reached', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        count: 3, // Total 3 occurrences (Occ 1, Occ 2, Occ 3)
        timezone: cairoTz,
      };

      const day1 = new Date('2026-11-01T07:00:00Z'); // Occ 1

      // Next after Occ 1 (occurrenceIndex: 1) -> Occ 2
      const day2 = calculateNextOccurrence(rule, day1, { occurrenceIndex: 1 });
      expect(day2).not.toBeNull();

      // Next after Occ 2 (occurrenceIndex: 2) -> Occ 3
      const day3 = calculateNextOccurrence(rule, day2!, { occurrenceIndex: 2 });
      expect(day3).not.toBeNull();

      // Next after Occ 3 (occurrenceIndex: 3) -> reaches count limit 3 -> returns null
      const day4 = calculateNextOccurrence(rule, day3!, { occurrenceIndex: 3 });
      expect(day4).toBeNull();
    });

    it('projectOccurrencesInRange respects count limit across multi-occurrence projections', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        count: 4,
        timezone: cairoTz,
      };

      const initialStart = '2026-11-01T07:00:00Z';
      const rangeStart = '2026-11-01T00:00:00Z';
      const rangeEnd = '2026-11-30T23:59:59Z'; // Full month range

      const occurrences = projectOccurrencesInRange(rule, initialStart, rangeStart, rangeEnd);

      // Must produce exactly 4 occurrences (Nov 1, 2, 3, 4) despite the 30-day range
      expect(occurrences.length).toBe(4);
      expect(occurrences[0].occurrenceIndex).toBe(1);
      expect(occurrences[3].occurrenceIndex).toBe(4);
      expect(formatInTimeZone(occurrences[3].date, cairoTz)).toContain('Nov 04, 2026');
    });
  });

  describe('8. Late Completion & Skip-Slot Policy (calculateNextUpcomingSlot)', () => {
    it('skips missed slots on overdue completion to schedule the next upcoming slot', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        timezone: cairoTz,
        dtstart: '2026-11-01T07:00:00Z',
      };

      // Task was scheduled for Nov 1 at 09:00 AM Cairo
      const scheduledDate = '2026-11-01T07:00:00Z';
      // User completes it on Nov 5 at 02:00 PM (12:00 UTC)
      const completionTime = '2026-11-05T12:00:00Z';

      const result = calculateNextUpcomingSlot(rule, scheduledDate, completionTime);

      expect(result).not.toBeNull();
      // Missed slots: Nov 2, Nov 3, Nov 4, Nov 5 (already past 09:00 AM)
      // Next upcoming slot must be Nov 6 at 09:00 AM Cairo!
      expect(formatInTimeZone(result!.nextSlot, cairoTz)).toContain('Nov 06, 2026');
      expect(formatInTimeZone(result!.nextSlot, cairoTz)).toContain('09:00 AM');
      expect(result!.nextOccurrenceIndex).toBe(6); // Slot 1..5 elapsed, next is 6
      expect(result!.skippedSlots).toBe(4); // Nov 2, 3, 4, 5 were skipped
    });

    it('terminates without creating upcoming slot if count is exhausted by skipped slots', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        count: 3, // Total 3 occurrences allowed
        timezone: cairoTz,
        dtstart: '2026-11-01T07:00:00Z',
      };

      const scheduledDate = '2026-11-01T07:00:00Z';
      // User completes 10 days later -> count of 3 was exhausted on Nov 3
      const lateCompletion = '2026-11-10T12:00:00Z';

      const result = calculateNextUpcomingSlot(rule, scheduledDate, lateCompletion);
      expect(result).toBeNull();
    });
  });

  describe('9. Range Projection (generateOccurrencesInRange & projectOccurrencesInRange)', () => {
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
  });

  describe('10. Schedule Attributes: scheduled_start, scheduled_end, due_date, and all-day', () => {
    it('preserves task duration between scheduled_start and scheduled_end across recurrence cycles', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'weekly',
        interval: 1,
        by_weekday: [1], // Monday
        timezone: cairoTz,
      };

      // 90-minute task: Monday 09:00 AM - 10:30 AM Cairo (UTC+2 in winter)
      const start1 = new Date('2026-11-02T07:00:00Z');
      const end1 = new Date('2026-11-02T08:30:00Z');
      const durationMs = end1.getTime() - start1.getTime(); // 90 min

      const nextStart = calculateNextOccurrence(rule, start1);
      expect(nextStart).not.toBeNull();
      expect(nextStart?.toISOString()).toBe('2026-11-09T07:00:00.000Z');

      const nextEnd = new Date(nextStart!.getTime() + durationMs);
      expect(nextEnd.toISOString()).toBe('2026-11-09T08:30:00.000Z');
      expect(formatInTimeZone(nextStart!, cairoTz)).toContain('09:00 AM');
      expect(formatInTimeZone(nextEnd, cairoTz)).toContain('10:30 AM');
    });

    it('preserves due_date time-of-day when recurring on due_date only', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'monthly',
        interval: 1,
        by_monthday: [15],
        timezone: cairoTz,
      };

      // Due at 05:00 PM Cairo (15:00 UTC) on Nov 15
      const dueNov = new Date('2026-11-15T15:00:00Z');
      const dueDec = calculateNextOccurrence(rule, dueNov);

      expect(dueDec).not.toBeNull();
      expect(formatInTimeZone(dueDec!, cairoTz)).toContain('Dec 15, 2026');
      expect(formatInTimeZone(dueDec!, cairoTz)).toContain('05:00 PM');
    });

    it('advances all-day tasks stably by calendar day without shifting across midnight', () => {
      const rule: RecurrenceRuleParams = {
        frequency: 'daily',
        interval: 1,
        timezone: cairoTz,
      };

      // All-day task starts at 00:00 local time
      // Cairo 2026-11-01 00:00:00 (UTC+2) = 2026-10-31T22:00:00Z
      const allDayStart = new Date('2026-10-31T22:00:00Z');
      expect(formatInTimeZone(allDayStart, cairoTz)).toContain('12:00 AM');
      expect(formatInTimeZone(allDayStart, cairoTz)).toContain('Nov 01, 2026');

      const nextAllDay = calculateNextOccurrence(rule, allDayStart);
      expect(nextAllDay).not.toBeNull();
      expect(formatInTimeZone(nextAllDay!, cairoTz)).toContain('12:00 AM');
      expect(formatInTimeZone(nextAllDay!, cairoTz)).toContain('Nov 02, 2026');
    });
  });
});
