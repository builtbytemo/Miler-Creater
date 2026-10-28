/**
 * Canonical IANA timezone for Cairo (Egypt).
 * Note: While the prompt requirement refers to "Asia/Cairo", the canonical IANA
 * identifier in tzdb and V8/Node Intl is "Africa/Cairo".
 * We provide transparent normalization so both identifiers function identically.
 */
export const DEFAULT_TIMEZONE = 'Africa/Cairo';
export const APPROVED_REQUIREMENT_ALIAS = 'Asia/Cairo';

const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Cairo': 'Africa/Cairo',
  'Egypt': 'Africa/Cairo',
};

/**
 * Normalizes common time zone aliases to canonical IANA identifiers.
 */
export function normalizeTimeZone(timeZone: string): string {
  if (!timeZone || typeof timeZone !== 'string') return DEFAULT_TIMEZONE;
  const trimmed = timeZone.trim();
  return TIMEZONE_ALIASES[trimmed] || trimmed;
}

/**
 * Validates that an IANA time zone identifier (or recognized alias) is supported.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    const canonical = normalizeTimeZone(timeZone);
    Intl.DateTimeFormat(undefined, { timeZone: canonical });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats a UTC ISO-8601 timestamp string for display in the user's configured time zone.
 */
export function formatInTimeZone(
  isoUtcTimestamp: string | Date,
  timeZone = DEFAULT_TIMEZONE,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = typeof isoUtcTimestamp === 'string' ? new Date(isoUtcTimestamp) : isoUtcTimestamp;
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date provided to formatInTimeZone');
  }

  const canonicalTz = normalizeTimeZone(timeZone);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: canonicalTz,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };

  return new Intl.DateTimeFormat('en-US', { ...defaultOptions, ...options }).format(date);
}

/**
 * Calculates the UTC offset in minutes for a given time zone at a specific moment in time.
 * Essential for verifying Daylight Saving Time transitions (e.g. Egypt UTC+2 vs UTC+3).
 */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const canonicalTz = normalizeTimeZone(timeZone);
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: canonicalTz }));
  return Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
}
