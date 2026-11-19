import type { ContentItemWithMeta } from '@/lib/services/content-service';
import { getCalendarDateKey } from '@/lib/temporal/calendar';

export type ContentDateFilter = 'today' | 'all';

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Returns true if the content item matches the selected day filter in the workspace timezone.
 */
export function matchesContentDate(
  item: ContentItemWithMeta,
  filter: ContentDateFilter,
  todayKey: string,
  timeZone: string
): boolean {
  if (filter === 'all') return true;
  if (!item.scheduled_at) return false;
  return getCalendarDateKey(item.scheduled_at, timeZone) === todayKey;
}

/**
 * Returns a new array of content items sorted chronologically from earliest scheduled_at
 * to latest, with unscheduled items placed after scheduled ones (newest created_at first).
 */
export function sortContentChronologically(items: ContentItemWithMeta[]): ContentItemWithMeta[] {
  return [...items].sort((a, b) => {
    const aMs = parseTimestampMs(a.scheduled_at);
    const bMs = parseTimestampMs(b.scheduled_at);

    if (aMs !== null && bMs !== null) {
      if (aMs !== bMs) return aMs - bMs;
    } else if (aMs !== null) {
      return -1;
    } else if (bMs !== null) {
      return 1;
    }

    const aCreated = parseTimestampMs(a.created_at) ?? 0;
    const bCreated = parseTimestampMs(b.created_at) ?? 0;
    return bCreated - aCreated;
  });
}
