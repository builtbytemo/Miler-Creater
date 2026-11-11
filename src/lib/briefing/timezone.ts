/**
 * IANA timezone helpers for Daily Briefing scheduling. Uses Intl (never a fixed UTC offset),
 * so DST transitions (e.g. Africa/Cairo) are handled by the platform tz database.
 */
export const DEFAULT_BRIEFING_TIMEZONE = 'Africa/Cairo';
export const DEFAULT_BRIEFING_LOCAL_TIME = '00:00';

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function getLocalParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Local calendar date (YYYY-MM-DD) in the given timezone at the given instant. */
export function getLocalDate(instant: Date, timeZone: string): string {
  const p = getLocalParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = getLocalParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(instant.getTime() / 60000) * 60000;
}

/**
 * Earliest instant at which the local wall clock in `timeZone` reads `localDate localTime`
 * or later on that date. If the wall time does not exist (spring-forward gap, e.g. Cairo
 * midnight on DST-start day) this is the first instant after the gap.
 */
export function localDateTimeToInstant(localDate: string, localTime: string, timeZone: string): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = localTime.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const candidates = new Set<number>();
  for (const probe of [naive - 36e5 * 14, naive, naive + 36e5 * 14]) {
    candidates.add(naive - offsetMs(new Date(probe), timeZone));
  }
  const sorted = [...candidates].sort((a, b) => a - b);
  for (const c of sorted) {
    const p = getLocalParts(new Date(c), timeZone);
    if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === naive) return new Date(c);
  }
  // Gap: pick the earliest candidate whose local time is after the target on that date.
  for (const c of sorted) {
    const p = getLocalParts(new Date(c), timeZone);
    if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) > naive) return new Date(c);
  }
  return new Date(sorted[0]);
}

export interface DueDecision {
  due: boolean;
  localDate: string;
  scheduledFor: Date;
}

/**
 * A briefing for the user's current local date is due once `now` has reached the configured
 * local time. Late runs still resolve to today's local date (catch-up within the day);
 * previous days are never back-filled.
 */
export function evaluateDue(now: Date, timeZone: string, localTime: string): DueDecision {
  const localDate = getLocalDate(now, timeZone);
  const scheduledFor = localDateTimeToInstant(localDate, localTime, timeZone);
  return { due: now.getTime() >= scheduledFor.getTime(), localDate, scheduledFor };
}
