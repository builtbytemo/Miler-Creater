import { getCalendarDateKey, getLocalParts } from '@/lib/temporal/calendar';
import { normalizeTimeZone } from '@/lib/temporal/timezone';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function tz(timezone: string): string {
  return normalizeTimeZone(timezone);
}

/** Local YYYY-MM-DD of an instant in `timezone` (the same helper the calendar UI uses). */
export function dateKeyOf(instant: string | Date, timezone: string): string {
  return getCalendarDateKey(instant, tz(timezone));
}

/** "9:00 AM". Built from numeric parts (never Intl text) so output has no locale-specific spaces. */
export function formatClock(instant: string | Date, timezone: string): string {
  const p = getLocalParts(typeof instant === 'string' ? new Date(instant) : instant, tz(timezone));
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour >= 12 ? 'PM' : 'AM'}`;
}

function dateParts(dateKey: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = dateKey.split('-').map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Wednesday, November 11, 2026". */
export function formatLongDate(dateKey: string): string {
  const { y, m, d, weekday } = dateParts(dateKey);
  return `${WEEKDAYS[weekday]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Wed, Nov 11". */
export function formatShortDate(dateKey: string): string {
  const { m, d, weekday } = dateParts(dateKey);
  return `${WEEKDAYS[weekday].slice(0, 3)}, ${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/** Clock label; adds the date when the instant is not on `briefingDate`. */
export function formatClockWithDate(instant: string, timezone: string, briefingDate: string): string {
  const key = dateKeyOf(instant, timezone);
  const clock = formatClock(instant, timezone);
  return key === briefingDate ? clock : `${formatShortDate(key)}, ${clock}`;
}

/** UTC [from, to] window guaranteed to contain every instant of local date `dateKey` in any timezone. */
export function utcWindowForDate(dateKey: string): { from: string; to: string } {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayStartUtc = Date.UTC(y, m - 1, d);
  const H = 3_600_000;
  return { from: new Date(dayStartUtc - 14 * H).toISOString(), to: new Date(dayStartUtc + 24 * H + 12 * H).toISOString() };
}
