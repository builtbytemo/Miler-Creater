import {
  DEFAULT_TIMEZONE,
  normalizeTimeZone,
  isValidTimeZone,
} from './timezone';

/**
 * Breakdown of a local wall-clock moment in a target IANA timezone.
 */
export interface LocalParts {
  /** Gregorian year in the target timezone (e.g. 2026) */
  year: number;
  /** Month in target timezone (1 = January, 12 = December) */
  month: number;
  /** Day of the month in target timezone (1 - 31) */
  day: number;
  /** Hour of the day in target timezone (0 - 23, 24-hour clock) */
  hour: number;
  /** Minute of the hour in target timezone (0 - 59) */
  minute: number;
  /** Second of the minute in target timezone (0 - 59) */
  second: number;
  /** ISO 8601 day of the week (1 = Monday, 2 = Tuesday, ..., 7 = Sunday) */
  weekday: number;
  /** Short English weekday name ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun') */
  weekdayName: string;
}

/**
 * Information describing a single local calendar day.
 */
export interface CalendarDayInfo {
  /** Local calendar date key formatted as YYYY-MM-DD */
  dateKey: string;
  /** Exact UTC instant corresponding to local 00:00:00.000 start of this day */
  startOfDay: Date;
  /** Exact UTC instant corresponding to local 23:59:59.999 end of this day */
  endOfDay: Date;
  /** Gregorian year in the target timezone (e.g. 2026) */
  year: number;
  /** Month in target timezone (1 - 12) */
  month: number;
  /** Day of the month in target timezone (1 - 31) */
  day: number;
  /** ISO weekday number (1 = Monday, ..., 7 = Sunday) */
  weekday: number;
  /** Short weekday name (e.g. 'Mon', 'Tue') */
  weekdayName: string;
}

/**
 * Result of computing a Monday-to-Sunday calendar week.
 */
export interface WeekRange {
  /** UTC Date corresponding to Monday 00:00:00.000 in target timezone */
  weekStart: Date;
  /** UTC Date corresponding to Sunday 23:59:59.999 in target timezone */
  weekEnd: Date;
  /** ISO 8601 string of weekStart */
  weekStartIso: string;
  /** ISO 8601 string of weekEnd */
  weekEndIso: string;
  /** Human-readable week range label in English, e.g. "Oct 26 – Nov 1, 2026" */
  label: string;
  /** Array of exactly 7 days from Monday through Sunday */
  days: CalendarDayInfo[];
}

/**
 * Result of computing a calendar month range.
 */
export interface MonthRange {
  /** UTC Date corresponding to the 1st day of the month at 00:00:00.000 in target timezone */
  monthStart: Date;
  /** UTC Date corresponding to the last day of the month at 23:59:59.999 in target timezone */
  monthEnd: Date;
  /** ISO 8601 string of monthStart */
  monthStartIso: string;
  /** ISO 8601 string of monthEnd */
  monthEndIso: string;
  /** Gregorian year in target timezone */
  year: number;
  /** Month number in target timezone (1 - 12) */
  month: number;
  /** Total days in this month (28, 29, 30, or 31) */
  totalDays: number;
  /** Human-readable month label, e.g. "October 2026" */
  label: string;
}

/**
 * Individual cell within a monthly calendar grid.
 */
export interface CalendarGridCell extends CalendarDayInfo {
  /** True if this day belongs to the primary focus month being displayed */
  isCurrentMonth: boolean;
  /** True if this day is a leading day from the previous calendar month */
  isLeading: boolean;
  /** True if this day is a trailing day from the next calendar month */
  isTrailing: boolean;
}

/**
 * Result of generating a complete Monday-start monthly calendar grid.
 */
export interface MonthGrid {
  /** Primary focus year */
  year: number;
  /** Primary focus month (1 - 12) */
  month: number;
  /** Human-readable month label, e.g. "March 2026" */
  label: string;
  /** Number of complete rows in the grid (e.g. 5 or 6, or 4 for Feb) */
  totalRows: number;
  /** Total number of cells (totalRows * 7) */
  totalCells: number;
  /** Array of all cells in the grid, row-by-row Monday to Sunday */
  cells: CalendarGridCell[];
}

export interface MonthGridOptions {
  /** Optional minimum number of rows to enforce (e.g. 6 for a fixed 6x7 grid) */
  fixedRows?: number;
}

/**
 * Result of computing a single calendar day range.
 */
export interface DayRange {
  /** UTC Date corresponding to local 00:00:00.000 start of this day */
  dayStart: Date;
  /** UTC Date corresponding to local 23:59:59.999 end of this day */
  dayEnd: Date;
  /** ISO 8601 string of dayStart */
  dayStartIso: string;
  /** ISO 8601 string of dayEnd */
  dayEndIso: string;
  /** Local calendar date key (YYYY-MM-DD) */
  dateKey: string;
  /** Human-readable day label, e.g. "Thursday, Oct 29, 2026" */
  label: string;
  /** Detailed day information */
  dayInfo: CalendarDayInfo;
}

const ISO_WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const SHORT_WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MONTH_NAMES = [
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
  'December',
];

const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Validates and canonicalizes a timezone parameter.
 * Throws a descriptive Error if an invalid timezone string is supplied.
 */
function resolveTimeZone(timeZone?: string): string {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    return DEFAULT_TIMEZONE;
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid timezone provided: ${timeZone}`);
  }
  return normalizeTimeZone(timeZone);
}

/**
 * Validates a Date or ISO string parameter and returns a valid Date instance.
 */
function resolveDate(dateInput: Date | string, fnName: string): Date {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    throw new Error(`Invalid date provided to ${fnName}`);
  }
  return d;
}

/**
 * Extracts wall-clock date and time components in the given time zone.
 * Uses `hourCycle: 'h23'` to guarantee deterministic 00:00 midnight parsing.
 */
export function getLocalParts(date: Date, timeZone = DEFAULT_TIMEZONE): LocalParts {
  const canonicalTz = resolveTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: canonicalTz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const weekdayName = partMap['weekday'] || 'Mon';
  const weekday = ISO_WEEKDAYS[weekdayName] || 1;

  return {
    year: parseInt(partMap['year'], 10),
    month: parseInt(partMap['month'], 10),
    day: parseInt(partMap['day'], 10),
    hour: parseInt(partMap['hour'], 10),
    minute: parseInt(partMap['minute'], 10),
    second: parseInt(partMap['second'], 10),
    weekday,
    weekdayName,
  };
}

/**
 * Constructs an exact UTC Date instance that corresponds to the given local wall-clock
 * time in the target time zone. Automatically handles daylight-saving time offsets.
 */
export function createUtcFromLocal(
  year: number,
  month: number, // 1 - 12
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
  timeZone = DEFAULT_TIMEZONE
): Date {
  const canonicalTz = resolveTimeZone(timeZone);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let estimate = new Date(targetUtc);

  // Convergence loop to find the exact instant where wall-clock in target timeZone matches
  for (let i = 0; i < 4; i++) {
    const local = getLocalParts(estimate, canonicalTz);
    const actualUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    const diffMs = targetUtc - actualUtc;
    if (diffMs === 0) break;
    estimate = new Date(estimate.getTime() + diffMs);
  }

  estimate.setUTCMilliseconds(millisecond);
  return estimate;
}

/**
 * Returns the total number of days in the specified year and month.
 * Handles leap years correctly (e.g. Feb 2024 = 29, Feb 2026 = 28).
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Returns the local calendar-date key formatted as `YYYY-MM-DD` for a given
 * scheduled timestamp instant in the target time zone.
 *
 * @param date - UTC Date or ISO 8601 string representing a scheduled instant.
 * @param timeZone - Target IANA timezone identifier (e.g. 'Africa/Cairo', 'UTC').
 * @returns Date key in `YYYY-MM-DD` format (e.g. '2026-10-29').
 */
export function getCalendarDateKey(
  date: Date | string,
  timeZone = DEFAULT_TIMEZONE
): string {
  const d = resolveDate(date, 'getCalendarDateKey');
  const canonicalTz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, canonicalTz);
  const y = String(local.year).padStart(4, '0');
  const m = String(local.month).padStart(2, '0');
  const day = String(local.day).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats a human-readable English label for a week range.
 *
 * Examples:
 * - Same month: `"Nov 2 – 8, 2026"`
 * - Crossing months: `"Oct 26 – Nov 1, 2026"`
 * - Crossing years: `"Dec 28, 2026 – Jan 3, 2027"`
 */
export function formatWeekLabel(
  weekStart: Date | string,
  weekEnd: Date | string,
  timeZone = DEFAULT_TIMEZONE
): string {
  const start = resolveDate(weekStart, 'formatWeekLabel');
  const end = resolveDate(weekEnd, 'formatWeekLabel');
  const tz = resolveTimeZone(timeZone);

  const startLocal = getLocalParts(start, tz);
  const endLocal = getLocalParts(end, tz);

  const startMonthName = SHORT_MONTH_NAMES[startLocal.month - 1];
  const endMonthName = SHORT_MONTH_NAMES[endLocal.month - 1];

  // Case 1: Same month and year
  if (startLocal.year === endLocal.year && startLocal.month === endLocal.month) {
    return `${startMonthName} ${startLocal.day} – ${endLocal.day}, ${startLocal.year}`;
  }

  // Case 2: Crossing month, same year
  if (startLocal.year === endLocal.year) {
    return `${startMonthName} ${startLocal.day} – ${endMonthName} ${endLocal.day}, ${startLocal.year}`;
  }

  // Case 3: Crossing year
  return `${startMonthName} ${startLocal.day}, ${startLocal.year} – ${endMonthName} ${endLocal.day}, ${endLocal.year}`;
}

/**
 * Formats a human-readable month label, e.g. "October 2026".
 * Can be called with (year, month) or with (Date, timeZone).
 */
export function formatMonthLabel(
  dateOrYear: Date | string | number,
  monthOrTimeZone?: number | string,
  timeZoneOverride?: string
): string {
  if (typeof dateOrYear === 'number') {
    const year = dateOrYear;
    const month = typeof monthOrTimeZone === 'number' ? monthOrTimeZone : 1;
    const safeMonth = Math.max(1, Math.min(12, month));
    return `${MONTH_NAMES[safeMonth - 1]} ${year}`;
  }

  const tz =
    typeof monthOrTimeZone === 'string'
      ? monthOrTimeZone
      : timeZoneOverride || DEFAULT_TIMEZONE;
  const canonicalTz = resolveTimeZone(tz);
  const date = resolveDate(dateOrYear, 'formatMonthLabel');
  const local = getLocalParts(date, canonicalTz);
  return `${MONTH_NAMES[local.month - 1]} ${local.year}`;
}

/**
 * Calculates the Monday-to-Sunday calendar week containing the given reference date,
 * strictly evaluated in the supplied IANA time zone.
 *
 * @param referenceDate - UTC Date or ISO 8601 string.
 * @param timeZone - Target IANA timezone.
 * @returns Complete `WeekRange` with 7 consecutive `CalendarDayInfo` items from Monday to Sunday.
 */
export function getWeekRange(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE
): WeekRange {
  const d = resolveDate(referenceDate, 'getWeekRange');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);

  // ISO weekday: 1 = Monday, ..., 7 = Sunday.
  const daysFromMonday = local.weekday - 1;
  const mondayUtc = new Date(Date.UTC(local.year, local.month - 1, local.day - daysFromMonday));
  const mYear = mondayUtc.getUTCFullYear();
  const mMonth = mondayUtc.getUTCMonth() + 1;
  const mDay = mondayUtc.getUTCDate();

  const days: CalendarDayInfo[] = [];

  for (let i = 0; i < 7; i++) {
    const dayUtc = new Date(Date.UTC(mYear, mMonth - 1, mDay + i));
    const cYear = dayUtc.getUTCFullYear();
    const cMonth = dayUtc.getUTCMonth() + 1;
    const cDay = dayUtc.getUTCDate();
    const cWeekday = i + 1;
    const cWeekdayName = SHORT_WEEKDAY_NAMES[i];
    const dateKey = `${String(cYear).padStart(4, '0')}-${String(cMonth).padStart(2, '0')}-${String(cDay).padStart(2, '0')}`;

    const startOfDay = createUtcFromLocal(cYear, cMonth, cDay, 0, 0, 0, 0, tz);
    const endOfDay = createUtcFromLocal(cYear, cMonth, cDay, 23, 59, 59, 999, tz);

    days.push({
      dateKey,
      startOfDay,
      endOfDay,
      year: cYear,
      month: cMonth,
      day: cDay,
      weekday: cWeekday,
      weekdayName: cWeekdayName,
    });
  }

  const weekStart = days[0].startOfDay;
  const weekEnd = days[6].endOfDay;

  return {
    weekStart,
    weekEnd,
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    label: formatWeekLabel(weekStart, weekEnd, tz),
    days,
  };
}

/**
 * Calculates the week range immediately following the given week.
 *
 * @param currentWeekStart - Start date of the current week (or any reference date in it).
 * @param timeZone - Target IANA timezone.
 */
export function getNextWeekRange(
  currentWeekStart: Date | string,
  timeZone = DEFAULT_TIMEZONE
): WeekRange {
  const d = resolveDate(currentWeekStart, 'getNextWeekRange');
  const tz = resolveTimeZone(timeZone);
  const nextMidday = new Date(d.getTime() + 7 * 86400000 + 43200000);
  return getWeekRange(nextMidday, tz);
}

/**
 * Calculates the week range immediately preceding the given week.
 *
 * @param currentWeekStart - Start date of the current week (or any reference date in it).
 * @param timeZone - Target IANA timezone.
 */
export function getPrevWeekRange(
  currentWeekStart: Date | string,
  timeZone = DEFAULT_TIMEZONE
): WeekRange {
  const d = resolveDate(currentWeekStart, 'getPrevWeekRange');
  const tz = resolveTimeZone(timeZone);
  const prevMidday = new Date(d.getTime() - 7 * 86400000 + 43200000);
  return getWeekRange(prevMidday, tz);
}

/**
 * Calculates the start and end of a calendar month in the supplied time zone.
 *
 * @param referenceDate - UTC Date or ISO 8601 string.
 * @param timeZone - Target IANA timezone.
 * @returns `MonthRange` representing the 1st day 00:00:00 to last day 23:59:59.999.
 */
export function getMonthRange(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE
): MonthRange {
  const d = resolveDate(referenceDate, 'getMonthRange');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);

  const year = local.year;
  const month = local.month;
  const totalDays = getDaysInMonth(year, month);

  const monthStart = createUtcFromLocal(year, month, 1, 0, 0, 0, 0, tz);
  const monthEnd = createUtcFromLocal(year, month, totalDays, 23, 59, 59, 999, tz);

  return {
    monthStart,
    monthEnd,
    monthStartIso: monthStart.toISOString(),
    monthEndIso: monthEnd.toISOString(),
    year,
    month,
    totalDays,
    label: formatMonthLabel(year, month),
  };
}

/**
 * Calculates a midday Date in the month immediately following referenceDate in the target timezone.
 * Handles month and year rollover (e.g. December 2026 -> January 2027).
 */
export function getNextMonthDate(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE
): Date {
  const d = resolveDate(referenceDate, 'getNextMonthDate');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);
  const nextMonth = local.month === 12 ? 1 : local.month + 1;
  const nextYear = local.month === 12 ? local.year + 1 : local.year;
  const daysInNext = getDaysInMonth(nextYear, nextMonth);
  const safeDay = Math.min(local.day, daysInNext);
  return createUtcFromLocal(nextYear, nextMonth, safeDay, 12, 0, 0, 0, tz);
}

/**
 * Calculates a midday Date in the month immediately preceding referenceDate in the target timezone.
 * Handles month and year rollback (e.g. January 2027 -> December 2026).
 */
export function getPrevMonthDate(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE
): Date {
  const d = resolveDate(referenceDate, 'getPrevMonthDate');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);
  const prevMonth = local.month === 1 ? 12 : local.month - 1;
  const prevYear = local.month === 1 ? local.year - 1 : local.year;
  const daysInPrev = getDaysInMonth(prevYear, prevMonth);
  const safeDay = Math.min(local.day, daysInPrev);
  return createUtcFromLocal(prevYear, prevMonth, safeDay, 12, 0, 0, 0, tz);
}

/**
 * Generates the complete array of dates needed for a Monday-start monthly calendar grid,
 * including leading dates from the previous month and trailing dates from the next month.
 *
 * @param referenceDate - UTC Date or ISO 8601 string representing the month to view.
 * @param timeZone - Target IANA timezone.
 * @param options - Configuration options such as `fixedRows`.
 * @returns `MonthGrid` with cells organized row-by-row, 7 days per row (Mon to Sun).
 */
export function getMonthGrid(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE,
  options?: MonthGridOptions
): MonthGrid {
  const d = resolveDate(referenceDate, 'getMonthGrid');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);

  const year = local.year;
  const month = local.month;
  const totalDays = getDaysInMonth(year, month);

  // Determine weekday of day 1 in this timezone
  const firstDayUtc = createUtcFromLocal(year, month, 1, 12, 0, 0, 0, tz);
  const firstDayLocal = getLocalParts(firstDayUtc, tz);
  const firstDayWeekday = firstDayLocal.weekday; // 1 = Monday, ..., 7 = Sunday

  // Monday-start grid: number of leading days from previous month
  const leadingDaysCount = firstDayWeekday - 1;

  // Calculate row counts
  const naturalRows = Math.ceil((leadingDaysCount + totalDays) / 7);
  const totalRows = options?.fixedRows
    ? Math.max(naturalRows, options.fixedRows)
    : naturalRows;
  const totalCells = totalRows * 7;

  // Determine start date of grid (Monday of the first row)
  const gridStartUtc = new Date(Date.UTC(year, month - 1, 1 - leadingDaysCount));
  const sYear = gridStartUtc.getUTCFullYear();
  const sMonth = gridStartUtc.getUTCMonth() + 1;
  const sDay = gridStartUtc.getUTCDate();

  const cells: CalendarGridCell[] = [];

  for (let i = 0; i < totalCells; i++) {
    const cellUtc = new Date(Date.UTC(sYear, sMonth - 1, sDay + i));
    const cYear = cellUtc.getUTCFullYear();
    const cMonth = cellUtc.getUTCMonth() + 1;
    const cDay = cellUtc.getUTCDate();
    const cWeekday = (i % 7) + 1;
    const cWeekdayName = SHORT_WEEKDAY_NAMES[i % 7];
    const dateKey = `${String(cYear).padStart(4, '0')}-${String(cMonth).padStart(2, '0')}-${String(cDay).padStart(2, '0')}`;

    const startOfDay = createUtcFromLocal(cYear, cMonth, cDay, 0, 0, 0, 0, tz);
    const endOfDay = createUtcFromLocal(cYear, cMonth, cDay, 23, 59, 59, 999, tz);

    const isLeading = i < leadingDaysCount;
    const isTrailing = i >= leadingDaysCount + totalDays;
    const isCurrentMonth = !isLeading && !isTrailing;

    cells.push({
      dateKey,
      startOfDay,
      endOfDay,
      year: cYear,
      month: cMonth,
      day: cDay,
      weekday: cWeekday,
      weekdayName: cWeekdayName,
      isCurrentMonth,
      isLeading,
      isTrailing,
    });
  }

  return {
    year,
    month,
    label: formatMonthLabel(year, month),
    totalRows,
    totalCells,
    cells,
  };
}

const FULL_WEEKDAY_NAMES: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

/**
 * Formats a human-readable English day label, e.g. "Thursday, Oct 29, 2026".
 */
export function formatDayLabel(
  date: Date | string,
  timeZone = DEFAULT_TIMEZONE
): string {
  const d = resolveDate(date, 'formatDayLabel');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);
  const fullDay = FULL_WEEKDAY_NAMES[local.weekdayName] || local.weekdayName;
  const monthName = SHORT_MONTH_NAMES[local.month - 1];
  return `${fullDay}, ${monthName} ${local.day}, ${local.year}`;
}

/**
 * Calculates the exact start and end of a single calendar day in the target timezone.
 */
export function getDayRange(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE
): DayRange {
  const d = resolveDate(referenceDate, 'getDayRange');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);

  const startOfDay = createUtcFromLocal(local.year, local.month, local.day, 0, 0, 0, 0, tz);
  const endOfDay = createUtcFromLocal(local.year, local.month, local.day, 23, 59, 59, 999, tz);
  const dateKey = `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;

  const dayInfo: CalendarDayInfo = {
    dateKey,
    startOfDay,
    endOfDay,
    year: local.year,
    month: local.month,
    day: local.day,
    weekday: local.weekday,
    weekdayName: local.weekdayName,
  };

  return {
    dayStart: startOfDay,
    dayEnd: endOfDay,
    dayStartIso: startOfDay.toISOString(),
    dayEndIso: endOfDay.toISOString(),
    dateKey,
    label: formatDayLabel(startOfDay, tz),
    dayInfo,
  };
}

/**
 * Calculates a midday Date in the day immediately following referenceDate in target timezone.
 */
export function getNextDayDate(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE
): Date {
  const d = resolveDate(referenceDate, 'getNextDayDate');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);
  // Add 1 calendar day
  const nextMiddayUtc = new Date(Date.UTC(local.year, local.month - 1, local.day + 1, 12, 0, 0));
  const nYear = nextMiddayUtc.getUTCFullYear();
  const nMonth = nextMiddayUtc.getUTCMonth() + 1;
  const nDay = nextMiddayUtc.getUTCDate();
  return createUtcFromLocal(nYear, nMonth, nDay, 12, 0, 0, 0, tz);
}

/**
 * Calculates a midday Date in the day immediately preceding referenceDate in target timezone.
 */
export function getPrevDayDate(
  referenceDate: Date | string,
  timeZone = DEFAULT_TIMEZONE
): Date {
  const d = resolveDate(referenceDate, 'getPrevDayDate');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);
  // Subtract 1 calendar day
  const prevMiddayUtc = new Date(Date.UTC(local.year, local.month - 1, local.day - 1, 12, 0, 0));
  const pYear = prevMiddayUtc.getUTCFullYear();
  const pMonth = prevMiddayUtc.getUTCMonth() + 1;
  const pDay = prevMiddayUtc.getUTCDate();
  return createUtcFromLocal(pYear, pMonth, pDay, 12, 0, 0, 0, tz);
}

/**
 * Converts a UTC Date or ISO string into a local HTML datetime-local string (YYYY-MM-DDTHH:mm)
 * strictly evaluated in the specified time zone.
 */
export function toLocalDatetimeString(
  date?: Date | string | null,
  timeZone = DEFAULT_TIMEZONE
): string {
  if (!date) return '';
  const d = resolveDate(date, 'toLocalDatetimeString');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);
  const y = String(local.year).padStart(4, '0');
  const m = String(local.month).padStart(2, '0');
  const day = String(local.day).padStart(2, '0');
  const h = String(local.hour).padStart(2, '0');
  const min = String(local.minute).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

/**
 * Parses an HTML datetime-local string (YYYY-MM-DDTHH:mm) as a local wall-clock time
 * in the specified time zone and converts it to an exact UTC Date instance.
 */
export function parseLocalDatetimeString(
  datetimeStr?: string | null,
  timeZone = DEFAULT_TIMEZONE
): Date | null {
  if (!datetimeStr || typeof datetimeStr !== 'string') return null;
  const match = datetimeStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    const d = new Date(datetimeStr);
    return isNaN(d.getTime()) ? null : d;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = match[6] ? parseInt(match[6], 10) : 0;
  const tz = resolveTimeZone(timeZone);
  return createUtcFromLocal(year, month, day, hour, minute, second, 0, tz);
}

/**
 * Extracts the local hour (0-23) and minute (0-59) of a scheduled timestamp in the given timezone.
 */
export function getItemHourInTimeZone(
  date: Date | string,
  timeZone = DEFAULT_TIMEZONE
): { hour: number; minute: number } {
  const d = resolveDate(date, 'getItemHourInTimeZone');
  const tz = resolveTimeZone(timeZone);
  const local = getLocalParts(d, tz);
  return { hour: local.hour, minute: local.minute };
}
