import { normalizeTimeZone, DEFAULT_TIMEZONE } from './timezone';

export interface RecurrenceRuleParams {
  id?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  interval: number;
  by_weekday?: number[] | null; // 1 = Monday, 7 = Sunday (ISO 8601)
  by_monthday?: number[] | null; // 1 - 31
  until_date?: string | Date | null;
  count?: number | null;
  timezone?: string;
}

interface LocalParts {
  year: number;
  month: number; // 1 - 12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1 = Monday, 7 = Sunday
}

/**
 * Extracts local date parts in the given time zone.
 */
function getLocalParts(date: Date, timeZone: string): LocalParts {
  const canonicalTz = normalizeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: canonicalTz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const weekdayStr = partMap['weekday'];
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    year: parseInt(partMap['year'], 10),
    month: parseInt(partMap['month'], 10),
    day: parseInt(partMap['day'], 10),
    hour: parseInt(partMap['hour'], 10) % 24,
    minute: parseInt(partMap['minute'], 10),
    second: parseInt(partMap['second'], 10),
    weekday: weekdayMap[weekdayStr] || 1,
  };
}

/**
 * Constructs a UTC Date object representing a specific wall-clock date & time in the target time zone.
 * Automatically accounts for local Daylight Saving Time offsets.
 */
function createUtcFromLocal(
  year: number,
  month: number, // 1 - 12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const canonicalTz = normalizeTimeZone(timeZone);

  // Initial estimate in UTC
  let estimate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Determine difference between estimated local output and target local wall-clock
  for (let i = 0; i < 3; i++) {
    const local = getLocalParts(estimate, canonicalTz);
    const diffMinutes =
      (year - local.year) * 525600 +
      (month - local.month) * 43200 +
      (day - local.day) * 1440 +
      (hour - local.hour) * 60 +
      (minute - local.minute);

    if (diffMinutes === 0) break;
    estimate = new Date(estimate.getTime() + diffMinutes * 60000);
  }

  return estimate;
}

/**
 * Returns the maximum days in a given year and month.
 */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Calculates the next chronological occurrence after `referenceDate` according to a recurrence rule.
 * Guarantees local wall-clock stability across daylight saving transitions.
 */
export function calculateNextOccurrence(
  rule: RecurrenceRuleParams,
  referenceDate: Date | string,
  timeZoneOverride?: string
): Date | null {
  const baseDate = typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate;
  if (isNaN(baseDate.getTime())) {
    throw new Error('Invalid referenceDate provided to calculateNextOccurrence');
  }

  const tz = rule.timezone || timeZoneOverride || DEFAULT_TIMEZONE;
  const interval = Math.max(1, rule.interval || 1);
  const local = getLocalParts(baseDate, tz);

  let nextTarget: Date | null = null;

  switch (rule.frequency) {
    case 'daily': {
      // Add interval days
      const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + interval));
      nextTarget = createUtcFromLocal(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth() + 1,
        targetDate.getUTCDate(),
        local.hour,
        local.minute,
        tz
      );
      break;
    }

    case 'weekly': {
      const weekdays = rule.by_weekday && rule.by_weekday.length > 0 ? [...rule.by_weekday].sort() : [local.weekday];
      // Find the next matching weekday in the current week or subsequent interval weeks
      let foundDayOffset: number | null = null;

      // 1. Look for a weekday later in the current week
      for (const w of weekdays) {
        if (w > local.weekday) {
          foundDayOffset = w - local.weekday;
          break;
        }
      }

      // 2. If no later weekday in the current week, jump to the first weekday of (now + interval weeks)
      if (foundDayOffset === null) {
        const daysToEndOfWeek = 7 - local.weekday;
        const daysToNextInterval = (interval - 1) * 7;
        const daysToFirstWeekday = weekdays[0];
        foundDayOffset = daysToEndOfWeek + daysToNextInterval + daysToFirstWeekday;
      }

      const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + foundDayOffset));
      nextTarget = createUtcFromLocal(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth() + 1,
        targetDate.getUTCDate(),
        local.hour,
        local.minute,
        tz
      );
      break;
    }

    case 'monthly': {
      let targetYear = local.year;
      let targetMonth = local.month + interval;

      while (targetMonth > 12) {
        targetYear += 1;
        targetMonth -= 12;
      }

      const preferredDay = rule.by_monthday && rule.by_monthday.length > 0 ? rule.by_monthday[0] : local.day;
      const daysInTargetMonth = getDaysInMonth(targetYear, targetMonth);
      const clampedDay = Math.min(preferredDay, daysInTargetMonth);

      nextTarget = createUtcFromLocal(targetYear, targetMonth, clampedDay, local.hour, local.minute, tz);
      break;
    }

    default:
      // Fallback for custom or yearly: advance by interval days
      const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + interval));
      nextTarget = createUtcFromLocal(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth() + 1,
        targetDate.getUTCDate(),
        local.hour,
        local.minute,
        tz
      );
      break;
  }

  // Check end conditions: until_date
  if (rule.until_date && nextTarget) {
    const until = typeof rule.until_date === 'string' ? new Date(rule.until_date) : rule.until_date;
    if (nextTarget.getTime() > until.getTime()) {
      return null;
    }
  }

  return nextTarget;
}

/**
 * Projects virtual recurring occurrences between `startDate` and `endDate` for calendar views.
 * Bounded by maximum iterations to prevent infinite loops.
 */
export function generateOccurrencesInRange(
  rule: RecurrenceRuleParams,
  initialStart: Date | string,
  rangeStart: Date | string,
  rangeEnd: Date | string,
  maxOccurrences = 100
): Date[] {
  const initDate = typeof initialStart === 'string' ? new Date(initialStart) : initialStart;
  const start = typeof rangeStart === 'string' ? new Date(rangeStart) : rangeStart;
  const end = typeof rangeEnd === 'string' ? new Date(rangeEnd) : rangeEnd;

  const results: Date[] = [];
  let current: Date | null = initDate;
  let iterations = 0;

  while (current && current.getTime() <= end.getTime() && results.length < maxOccurrences) {
    if (current.getTime() >= start.getTime()) {
      results.push(current);
    }

    current = calculateNextOccurrence(rule, current);
    iterations++;
    if (iterations > 500) break; // Hard safety boundary
  }

  return results;
}
