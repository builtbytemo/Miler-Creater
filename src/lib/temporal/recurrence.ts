import { normalizeTimeZone, isValidTimeZone, DEFAULT_TIMEZONE } from './timezone';

export interface RecurrenceRuleParams {
  id?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  interval: number;
  by_weekday?: number[] | null; // 1 = Monday, 7 = Sunday (ISO 8601)
  by_monthday?: number[] | null; // 1 - 31
  until_date?: string | Date | null;
  count?: number | null;
  timezone?: string;
  dtstart?: string | Date | null;
}

export interface RecurrenceOptions {
  timeZoneOverride?: string;
  occurrenceIndex?: number; // 1-based index of the reference occurrence
  anchorDate?: Date | string; // Explicit anchor date (defaults to dtstart or referenceDate)
}

export interface NextSlotResult {
  nextSlot: Date;
  nextOccurrenceIndex: number;
  skippedSlots: number;
}

export interface ProjectedOccurrence {
  date: Date;
  occurrenceIndex: number;
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
 * Validates recurrence rule parameters according to Miler's supported scheduling specifications.
 * Throws explicit, descriptive errors for invalid configurations or unsupported patterns.
 */
export function validateRecurrenceRule(rule: RecurrenceRuleParams): void {
  if (!rule) {
    throw new Error('Recurrence rule is required');
  }

  // 1. Frequency validation
  const validFrequencies = ['daily', 'weekly', 'monthly', 'yearly'];
  if (rule.frequency === 'custom' || !validFrequencies.includes(rule.frequency)) {
    throw new Error(
      `Unsupported recurrence frequency: '${rule.frequency}'. Miler officially supports 'daily', 'weekly', 'monthly', and 'yearly'.`
    );
  }

  // 2. Interval validation
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new Error(`Interval must be a positive integer >= 1. Received: ${rule.interval}`);
  }

  // 3. by_weekday validation
  if (rule.by_weekday !== undefined && rule.by_weekday !== null) {
    if (!Array.isArray(rule.by_weekday) || rule.by_weekday.length === 0) {
      throw new Error('by_weekday, if provided, must be a non-empty array of integers');
    }
    for (const w of rule.by_weekday) {
      if (!Number.isInteger(w) || w < 1 || w > 7) {
        throw new Error(`by_weekday elements must be integers between 1 (Monday) and 7 (Sunday). Received: ${w}`);
      }
    }
    const uniqueWeekdays = new Set(rule.by_weekday);
    if (uniqueWeekdays.size !== rule.by_weekday.length) {
      throw new Error('by_weekday cannot contain duplicate days');
    }
  }

  // 4. by_monthday validation
  if (rule.by_monthday !== undefined && rule.by_monthday !== null) {
    if (!Array.isArray(rule.by_monthday) || rule.by_monthday.length === 0) {
      throw new Error('by_monthday, if provided, must be a non-empty array of integers');
    }
    for (const d of rule.by_monthday) {
      if (!Number.isInteger(d) || d < 1 || d > 31) {
        throw new Error(`by_monthday elements must be integers between 1 and 31. Received: ${d}`);
      }
    }
    const uniqueMonthdays = new Set(rule.by_monthday);
    if (uniqueMonthdays.size !== rule.by_monthday.length) {
      throw new Error('by_monthday cannot contain duplicate days');
    }
  }

  // 5. Termination mutual exclusivity
  if (rule.until_date && rule.count !== undefined && rule.count !== null) {
    throw new Error('Cannot specify both until_date and count termination conditions.');
  }

  // 6. count validation
  if (rule.count !== undefined && rule.count !== null) {
    if (!Number.isInteger(rule.count) || rule.count < 1) {
      throw new Error(`count must be a positive integer >= 1. Received: ${rule.count}`);
    }
  }

  // 7. Timezone validation
  const tz = rule.timezone || DEFAULT_TIMEZONE;
  if (!isValidTimeZone(tz)) {
    throw new Error(`Invalid IANA timezone identifier: '${rule.timezone}'`);
  }
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
 * Parses until_date consistently with the configured timezone.
 * Date-only strings ('YYYY-MM-DD') are interpreted as ending at 23:59:59.999 in target timezone.
 */
function parseUntilDate(untilInput: string | Date, timeZone: string): number {
  if (untilInput instanceof Date) {
    return untilInput.getTime();
  }
  const str = untilInput.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    const endOfDayUtc = createUtcFromLocal(y, m, d, 23, 59, timeZone);
    return endOfDayUtc.getTime() + 59000 + 999;
  }
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid until_date: '${str}'`);
  }
  return parsed.getTime();
}

/**
 * Calculates the next chronological occurrence after `referenceDate` according to a recurrence rule.
 * Guarantees local wall-clock stability across daylight saving transitions and month clamping.
 */
export function calculateNextOccurrence(
  rule: RecurrenceRuleParams,
  referenceDate: Date | string,
  timeZoneOverrideOrOptions?: string | RecurrenceOptions
): Date | null {
  validateRecurrenceRule(rule);

  const baseDate = typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate;
  if (isNaN(baseDate.getTime())) {
    throw new Error('Invalid referenceDate provided to calculateNextOccurrence');
  }

  const options: RecurrenceOptions =
    typeof timeZoneOverrideOrOptions === 'string'
      ? { timeZoneOverride: timeZoneOverrideOrOptions }
      : timeZoneOverrideOrOptions || {};

  const tz = normalizeTimeZone(options.timeZoneOverride || rule.timezone || DEFAULT_TIMEZONE);
  const interval = Math.max(1, rule.interval || 1);

  // Check occurrence count limit if ordinal index is provided
  if (rule.count !== undefined && rule.count !== null) {
    if (options.occurrenceIndex !== undefined && options.occurrenceIndex !== null) {
      if (options.occurrenceIndex >= rule.count) {
        return null;
      }
    }
  }

  // Anchor date (defaults to dtstart, or anchorDate option, or baseDate)
  const anchorDate = options.anchorDate
    ? (typeof options.anchorDate === 'string' ? new Date(options.anchorDate) : options.anchorDate)
    : (rule.dtstart ? (typeof rule.dtstart === 'string' ? new Date(rule.dtstart) : rule.dtstart) : baseDate);

  const local = getLocalParts(baseDate, tz);
  const anchorLocal = getLocalParts(anchorDate, tz);

  let nextTarget: Date | null = null;

  switch (rule.frequency) {
    case 'daily': {
      const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + interval));
      nextTarget = createUtcFromLocal(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth() + 1,
        targetDate.getUTCDate(),
        anchorLocal.hour,
        anchorLocal.minute,
        tz
      );
      break;
    }

    case 'weekly': {
      const weekdays = rule.by_weekday && rule.by_weekday.length > 0
        ? [...rule.by_weekday].sort((a, b) => a - b)
        : [anchorLocal.weekday];

      let foundDayOffset: number | null = null;

      // 1. Look for a weekday later in the current week
      for (const w of weekdays) {
        if (w > local.weekday) {
          foundDayOffset = w - local.weekday;
          break;
        }
      }

      // 2. If no later weekday in the current week, jump to the first weekday of the next active week
      if (foundDayOffset === null) {
        const mondayRefUtc = Date.UTC(local.year, local.month - 1, local.day - (local.weekday - 1));
        const mondayAnchorUtc = Date.UTC(anchorLocal.year, anchorLocal.month - 1, anchorLocal.day - (anchorLocal.weekday - 1));
        const weekDiff = Math.round((mondayRefUtc - mondayAnchorUtc) / (7 * 86400000));

        let weeksToJump: number;
        if (interval === 1) {
          weeksToJump = 1;
        } else {
          const rem = ((weekDiff % interval) + interval) % interval;
          weeksToJump = rem === 0 ? interval : (interval - rem);
        }

        const daysToEndOfWeek = 7 - local.weekday;
        const daysInBetweenWeeks = (weeksToJump - 1) * 7;
        const daysToFirstWeekday = weekdays[0];
        foundDayOffset = daysToEndOfWeek + daysInBetweenWeeks + daysToFirstWeekday;
      }

      const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + foundDayOffset));
      nextTarget = createUtcFromLocal(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth() + 1,
        targetDate.getUTCDate(),
        anchorLocal.hour,
        anchorLocal.minute,
        tz
      );
      break;
    }

    case 'monthly': {
      // Preferred days are anchored to rule.by_monthday or the initial anchor date's day of month
      const preferredDays = rule.by_monthday && rule.by_monthday.length > 0
        ? [...rule.by_monthday].sort((a, b) => a - b)
        : [anchorLocal.day];

      let targetYear = local.year;
      let targetMonth = local.month;
      let targetDay: number | null = null;

      // Check if there is a later day in preferredDays within the current month
      const daysInCurrMonth = getDaysInMonth(targetYear, targetMonth);
      for (const d of preferredDays) {
        const clamped = Math.min(d, daysInCurrMonth);
        if (clamped > local.day) {
          targetDay = clamped;
          break;
        }
      }

      if (targetDay === null) {
        // Advance month by interval
        targetMonth += interval;
        while (targetMonth > 12) {
          targetYear += 1;
          targetMonth -= 12;
        }
        const daysInTargetMonth = getDaysInMonth(targetYear, targetMonth);
        const preferred = preferredDays[0];
        targetDay = Math.min(preferred, daysInTargetMonth);
      }

      nextTarget = createUtcFromLocal(
        targetYear,
        targetMonth,
        targetDay,
        anchorLocal.hour,
        anchorLocal.minute,
        tz
      );
      break;
    }

    case 'yearly': {
      const targetYear = local.year + interval;
      const targetMonth = anchorLocal.month;
      const preferredDay = (rule.by_monthday && rule.by_monthday.length > 0)
        ? rule.by_monthday[0]
        : anchorLocal.day;
      const daysInTargetMonth = getDaysInMonth(targetYear, targetMonth);
      const clampedDay = Math.min(preferredDay, daysInTargetMonth);

      nextTarget = createUtcFromLocal(
        targetYear,
        targetMonth,
        clampedDay,
        anchorLocal.hour,
        anchorLocal.minute,
        tz
      );
      break;
    }

    default: {
      const unknownFreq = (rule as { frequency?: unknown }).frequency;
      throw new Error(`Unsupported recurrence frequency: '${String(unknownFreq)}'`);
    }
  }

  // Check until_date termination condition
  if (rule.until_date && nextTarget) {
    const untilMs = parseUntilDate(rule.until_date, tz);
    if (nextTarget.getTime() > untilMs) {
      return null;
    }
  }

  return nextTarget;
}

/**
 * Calculates the next upcoming occurrence after `currentScheduledDate` that falls on or after `thresholdDate`.
 * Used for late task completions: skips missed scheduled slots without building an overdue backlog.
 * Correctly increments occurrence indices and checks count limits across skipped dates.
 */
export function calculateNextUpcomingSlot(
  rule: RecurrenceRuleParams,
  currentScheduledDate: Date | string,
  thresholdDate: Date | string,
  timeZoneOverrideOrOptions?: string | RecurrenceOptions
): NextSlotResult | null {
  const options: RecurrenceOptions =
    typeof timeZoneOverrideOrOptions === 'string'
      ? { timeZoneOverride: timeZoneOverrideOrOptions }
      : timeZoneOverrideOrOptions || {};

  const thresholdMs =
    typeof thresholdDate === 'string' ? new Date(thresholdDate).getTime() : thresholdDate.getTime();
  if (isNaN(thresholdMs)) {
    throw new Error('Invalid thresholdDate provided to calculateNextUpcomingSlot');
  }

  const initialIndex = options.occurrenceIndex ?? 1;
  let currentIndex = initialIndex;
  let currentSlot: Date | string = currentScheduledDate;
  let iterations = 0;

  while (iterations < 1000) {
    iterations++;
    const nextSlot = calculateNextOccurrence(rule, currentSlot, {
      ...options,
      occurrenceIndex: currentIndex,
    });

    if (!nextSlot) {
      return null; // Terminated by count or until_date
    }

    currentIndex++;

    // Found next upcoming slot on or after threshold
    if (nextSlot.getTime() >= thresholdMs) {
      const skippedSlots = currentIndex - initialIndex - 1;
      return {
        nextSlot,
        nextOccurrenceIndex: currentIndex,
        skippedSlots: Math.max(0, skippedSlots),
      };
    }

    currentSlot = nextSlot;
  }

  return null;
}

/**
 * Projects virtual recurring occurrences between `rangeStart` and `rangeEnd` for calendar views.
 * Bounded by maximum occurrences and termination boundaries (count, until_date).
 * Returns array of Date objects for backward compatibility.
 */
export function generateOccurrencesInRange(
  rule: RecurrenceRuleParams,
  initialStart: Date | string,
  rangeStart: Date | string,
  rangeEnd: Date | string,
  maxOccurrences = 100
): Date[] {
  const projected = projectOccurrencesInRange(rule, initialStart, rangeStart, rangeEnd, maxOccurrences);
  return projected.map((p) => p.date);
}

/**
 * Detailed virtual recurrence projection returning both the Date and the 1-based occurrenceIndex.
 */
export function projectOccurrencesInRange(
  rule: RecurrenceRuleParams,
  initialStart: Date | string,
  rangeStart: Date | string,
  rangeEnd: Date | string,
  maxOccurrences = 100,
  options?: {
    initialOccurrenceIndex?: number;
    anchorDate?: Date | string;
  }
): ProjectedOccurrence[] {
  const initDate = typeof initialStart === 'string' ? new Date(initialStart) : initialStart;
  const start = typeof rangeStart === 'string' ? new Date(rangeStart) : rangeStart;
  const end = typeof rangeEnd === 'string' ? new Date(rangeEnd) : rangeEnd;

  if (isNaN(initDate.getTime()) || isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid date parameters provided to projectOccurrencesInRange');
  }

  const results: ProjectedOccurrence[] = [];
  let current: Date | null = initDate;
  let occurrenceIndex = options?.initialOccurrenceIndex ?? 1;
  let iterations = 0;

  const tz = rule.timezone || DEFAULT_TIMEZONE;
  const anchorDate = options?.anchorDate
    ? typeof options.anchorDate === 'string'
      ? new Date(options.anchorDate)
      : options.anchorDate
    : rule.dtstart
      ? typeof rule.dtstart === 'string'
        ? new Date(rule.dtstart)
        : rule.dtstart
      : initDate;

  const effectiveRule: RecurrenceRuleParams = {
    ...rule,
    dtstart: anchorDate,
  };

  while (current && current.getTime() <= end.getTime() && results.length < maxOccurrences) {
    if (rule.count !== undefined && rule.count !== null && occurrenceIndex > rule.count) {
      break;
    }

    if (rule.until_date && current.getTime() > parseUntilDate(rule.until_date, tz)) {
      break;
    }

    if (current.getTime() >= start.getTime()) {
      results.push({
        date: current,
        occurrenceIndex,
      });
    }

    current = calculateNextOccurrence(effectiveRule, current, {
      occurrenceIndex,
      anchorDate,
      timeZoneOverride: tz,
    });
    occurrenceIndex++;
    iterations++;
    if (iterations > 2000) break; // Hard safety boundary
  }

  return results;
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export interface RecurrenceSummaryOptions {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | string;
  interval?: number | null;
  by_weekday?: number[] | null;
  by_monthday?: number[] | null;
  until_date?: string | null;
  count?: number | null;
  timezone?: string | null;
  total_occurrences_generated?: number | null;
}

/**
 * Returns a human-readable, user-friendly summary of a recurrence schedule.
 */
export function formatRecurrenceSummary(rule: RecurrenceSummaryOptions): string {
  const interval = rule.interval && rule.interval > 1 ? rule.interval : 1;
  const parts: string[] = [];

  switch (rule.frequency) {
    case 'daily':
      parts.push(interval === 1 ? 'Repeats daily' : `Repeats every ${interval} days`);
      break;
    case 'weekly': {
      let days = '';
      if (rule.by_weekday && rule.by_weekday.length > 0) {
        const sorted = [...rule.by_weekday].sort((a, b) => a - b);
        days = ' on ' + sorted.map((d) => WEEKDAY_NAMES[d] || `Day ${d}`).join(', ');
      }
      parts.push(interval === 1 ? `Repeats weekly${days}` : `Repeats every ${interval} weeks${days}`);
      break;
    }
    case 'monthly': {
      let dayPart = '';
      if (rule.by_monthday && rule.by_monthday.length > 0) {
        dayPart = ` on day ${rule.by_monthday.join(', ')}`;
      }
      parts.push(interval === 1 ? `Repeats monthly${dayPart}` : `Repeats every ${interval} months${dayPart}`);
      break;
    }
    case 'yearly':
      parts.push(interval === 1 ? 'Repeats yearly' : `Repeats every ${interval} years`);
      break;
    default:
      parts.push(`Repeats (${rule.frequency})`);
      break;
  }

  // Termination
  if (rule.count !== undefined && rule.count !== null) {
    if (rule.total_occurrences_generated !== undefined && rule.total_occurrences_generated !== null) {
      parts.push(`· ${rule.count} occurrences total (${rule.total_occurrences_generated} generated)`);
    } else {
      parts.push(`· Ends after ${rule.count} occurrences`);
    }
  } else if (rule.until_date) {
    const d = rule.until_date.includes('T') ? rule.until_date.split('T')[0] : rule.until_date;
    parts.push(`· Ends on ${d}`);
  }

  return parts.join(' ');
}
