import type { ContentItemWithMeta } from '@/lib/services/content-service';
import type { TaskWithMeta } from '@/lib/services/task-service';
import { getCalendarDateKey } from '@/lib/temporal/calendar';
import { DEFAULT_TIMEZONE } from '@/lib/temporal/timezone';

export const CALENDAR_PALETTE_NAMES = [
  'cobalt',
  'emerald',
  'amber',
  'violet',
  'rose',
  'cyan',
  'terracotta',
  'indigo',
] as const;

export type CalendarPaletteName = (typeof CALENDAR_PALETTE_NAMES)[number];

export interface CalendarItemColorToken {
  index: number;
  name: CalendarPaletteName;
  colorClass: string;
}

export const CALENDAR_PALETTE_SIZE = CALENDAR_PALETTE_NAMES.length; // 8

export function getPaletteTokenByIndex(index: number): CalendarItemColorToken {
  const normalized = ((index % CALENDAR_PALETTE_SIZE) + CALENDAR_PALETTE_SIZE) % CALENDAR_PALETTE_SIZE;
  return {
    index: normalized,
    name: CALENDAR_PALETTE_NAMES[normalized],
    colorClass: `cal-item-${normalized}`,
  };
}

/**
 * High-dispersion 32-bit hash (FNV-1a + MurmurHash3 finalizer avalanche)
 * so short or sequential IDs ('one', 'two', 't-1', 't-2') map to distinct slots.
 */
export function hashStringToPaletteIndex(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // MurmurHash3 32-bit finalizer mix
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return (h >>> 0) % CALENDAR_PALETTE_SIZE;
}

/**
 * Computes a canonical identity string for a task or content item.
 * Recurring items sharing `recurrence_rule_id` resolve to the same identity key
 * so all occurrences of a recurring series share a stable base color.
 */
export function getStableCalendarItemIdentity(
  kind: 'task' | 'content',
  item: {
    id: string;
    recurrence_rule_id?: string | null;
  }
): string {
  if (item.recurrence_rule_id) {
    return `${kind}:recurrence:${item.recurrence_rule_id}`;
  }
  const canonicalId = String(item.id)
    .replace(/:occurrence:.*$/, '')
    .replace(/_\d{4}-\d{2}-\d{2}.*$/, '');
  return `${kind}:id:${canonicalId}`;
}

/**
 * Returns the deterministic base color token for a single task or content item.
 */
export function getBaseCalendarItemColor(
  kind: 'task' | 'content',
  item: { id: string; recurrence_rule_id?: string | null }
): CalendarItemColorToken {
  const identity = getStableCalendarItemIdentity(kind, item);
  const index = hashStringToPaletteIndex(identity);
  return getPaletteTokenByIndex(index);
}

export type CalendarItemColorMap = Record<string, CalendarItemColorToken>;

export function getMapKeyForItem(kind: 'task' | 'content', id: string): string {
  return `${kind}:${id}`;
}

interface InternalColorCandidate {
  mapKey: string;
  identity: string;
  baseIndex: number;
  dateKey: string;
  startMs: number;
  endMs: number;
  hasRecurringRule: boolean;
}

/**
 * Builds a deterministic, order-independent color map for a collection of tasks and content items.
 * - Preserves each item's deterministic hash color whenever possible.
 * - Ensures recurring occurrences (`recurrence_rule_id`) stay locked to their series color.
 * - Within each local calendar day (sorted canonically by start time + end time + stable identity),
 *   prioritizes visibly distinct colors for items that overlap or appear adjacent to each other.
 */
export function buildCalendarItemColorMap(
  tasks: TaskWithMeta[] = [],
  contentItems: ContentItemWithMeta[] = [],
  timeZone: string = DEFAULT_TIMEZONE
): CalendarItemColorMap {
  const result: CalendarItemColorMap = {};
  const candidatesByDateKey: Record<string, InternalColorCandidate[]> = {};

  for (const task of tasks) {
    if (!task || !task.id) continue;
    const identity = getStableCalendarItemIdentity('task', task);
    const baseIndex = hashStringToPaletteIndex(identity);
    const mapKey = getMapKeyForItem('task', task.id);

    const effectiveStart =
      task.scheduled_start || (task.created_from !== 'calendar' ? task.due_date : null);

    if (!effectiveStart) {
      result[mapKey] = getPaletteTokenByIndex(baseIndex);
      continue;
    }

    const dateKey = getCalendarDateKey(effectiveStart, timeZone);
    const startMs = new Date(effectiveStart).getTime();
    const durationMs = (task.estimated_duration_minutes || 60) * 60_000;
    const rawEndMs = task.scheduled_end
      ? new Date(task.scheduled_end).getTime()
      : startMs + durationMs;
    const endMs = Math.max(startMs + 30 * 60_000, rawEndMs);

    if (!candidatesByDateKey[dateKey]) {
      candidatesByDateKey[dateKey] = [];
    }
    candidatesByDateKey[dateKey].push({
      mapKey,
      identity,
      baseIndex,
      dateKey,
      startMs,
      endMs,
      hasRecurringRule: Boolean(task.recurrence_rule_id),
    });
  }

  for (const item of contentItems) {
    if (!item || !item.id) continue;
    const identity = getStableCalendarItemIdentity('content', item);
    const baseIndex = hashStringToPaletteIndex(identity);
    const mapKey = getMapKeyForItem('content', item.id);

    if (!item.scheduled_at) {
      result[mapKey] = getPaletteTokenByIndex(baseIndex);
      continue;
    }

    const dateKey = getCalendarDateKey(item.scheduled_at, timeZone);
    const startMs = new Date(item.scheduled_at).getTime();
    const durationMs = (item.duration_minutes || 45) * 60_000;
    const endMs = startMs + Math.max(30 * 60_000, durationMs);

    if (!candidatesByDateKey[dateKey]) {
      candidatesByDateKey[dateKey] = [];
    }
    candidatesByDateKey[dateKey].push({
      mapKey,
      identity,
      baseIndex,
      dateKey,
      startMs,
      endMs,
      hasRecurringRule: Boolean(item.recurrence_rule_id),
    });
  }

  // Resolve each day canonically so item order in input arrays never changes colors
  for (const dateKey of Object.keys(candidatesByDateKey).sort()) {
    const dayItems = candidatesByDateKey[dateKey];
    dayItems.sort(
      (a, b) =>
        a.startMs - b.startMs ||
        a.endMs - b.endMs ||
        a.identity.localeCompare(b.identity) ||
        a.mapKey.localeCompare(b.mapKey)
    );

    const assignedByIdentity = new Map<string, number>();
    const placed: Array<{ startMs: number; endMs: number; colorIndex: number; identity: string }> = [];
    const usedOnDay = new Set<number>();

    for (const candidate of dayItems) {
      // If this exact identity (e.g. recurring series) already has a color, keep it consistent
      const existingIdentityColor = assignedByIdentity.get(candidate.identity);
      if (existingIdentityColor !== undefined) {
        result[candidate.mapKey] = getPaletteTokenByIndex(existingIdentityColor);
        placed.push({
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          colorIndex: existingIdentityColor,
          identity: candidate.identity,
        });
        usedOnDay.add(existingIdentityColor);
        continue;
      }

      // Recurring occurrences always stay locked to their series base color across all dates
      if (candidate.hasRecurringRule) {
        assignedByIdentity.set(candidate.identity, candidate.baseIndex);
        result[candidate.mapKey] = getPaletteTokenByIndex(candidate.baseIndex);
        placed.push({
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          colorIndex: candidate.baseIndex,
          identity: candidate.identity,
        });
        usedOnDay.add(candidate.baseIndex);
        continue;
      }

      // Collect colors of overlapping items and the immediately preceding item on this day
      const overlappingColors = new Set<number>();
      for (const prev of placed) {
        if (prev.startMs < candidate.endMs && prev.endMs > candidate.startMs) {
          overlappingColors.add(prev.colorIndex);
        }
      }
      const prevAdjacentColor =
        placed.length > 0 ? placed[placed.length - 1].colorIndex : null;

      let chosenIndex = candidate.baseIndex;
      const hasImmediateConflict =
        overlappingColors.has(chosenIndex) ||
        prevAdjacentColor === chosenIndex ||
        (usedOnDay.size < CALENDAR_PALETTE_SIZE && usedOnDay.has(chosenIndex));

      if (hasImmediateConflict) {
        // First pass: find a palette slot not used on this day AND not conflicting with overlap/adjacent
        let found = -1;
        for (let step = 1; step < CALENDAR_PALETTE_SIZE; step++) {
          const probe = (candidate.baseIndex + step * 3) % CALENDAR_PALETTE_SIZE;
          if (
            !overlappingColors.has(probe) &&
            probe !== prevAdjacentColor &&
            !usedOnDay.has(probe)
          ) {
            found = probe;
            break;
          }
        }
        // Second pass (when day has >= 8 items): avoid overlapping and immediately adjacent colors
        if (found === -1) {
          for (let step = 1; step < CALENDAR_PALETTE_SIZE; step++) {
            const probe = (candidate.baseIndex + step * 3) % CALENDAR_PALETTE_SIZE;
            if (!overlappingColors.has(probe) && probe !== prevAdjacentColor) {
              found = probe;
              break;
            }
          }
        }
        // Third pass: avoid at least the immediately preceding color
        if (found === -1) {
          for (let step = 1; step < CALENDAR_PALETTE_SIZE; step++) {
            const probe = (candidate.baseIndex + step * 3) % CALENDAR_PALETTE_SIZE;
            if (probe !== prevAdjacentColor) {
              found = probe;
              break;
            }
          }
        }
        if (found !== -1) {
          chosenIndex = found;
        }
      }

      assignedByIdentity.set(candidate.identity, chosenIndex);
      usedOnDay.add(chosenIndex);
      placed.push({
        startMs: candidate.startMs,
        endMs: candidate.endMs,
        colorIndex: chosenIndex,
        identity: candidate.identity,
      });
      result[candidate.mapKey] = getPaletteTokenByIndex(chosenIndex);
    }
  }

  return result;
}

/**
 * Looks up an item's resolved color token from a map, falling back to its deterministic base color.
 */
export function resolveCalendarItemColor(
  kind: 'task' | 'content',
  item: { id: string; recurrence_rule_id?: string | null },
  colorMap?: CalendarItemColorMap
): CalendarItemColorToken {
  const key = getMapKeyForItem(kind, item.id);
  if (colorMap && colorMap[key]) {
    return colorMap[key];
  }
  return getBaseCalendarItemColor(kind, item);
}
