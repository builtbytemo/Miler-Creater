import type { BriefingContent, BriefingSnapshot, BriefingTask, DayFinderBlock } from './model';
import { dateKeyOf, formatClock, formatClockWithDate, formatShortDate } from './time';

const KIND_LABEL = { scheduled: 'Scheduled', due: 'Due', publish: 'Publish' } as const;

/** Shared by both channels: "Scheduled 9:00 AM · Due 11:59 PM", or "Anytime". */
export function timeLabel(entry: BriefingTask | BriefingContent, snap: Pick<BriefingSnapshot, 'timezone' | 'localDate'>): string {
  if (entry.anytime || entry.times.length === 0) return 'Anytime';
  return entry.times
    .map((t) => {
      let text = `${KIND_LABEL[t.kind]} ${formatClockWithDate(t.at, snap.timezone, snap.localDate)}`;
      if (t.endAt) {
        const sameDay = dateKeyOf(t.endAt, snap.timezone) === dateKeyOf(t.at, snap.timezone);
        text += `–${sameDay ? formatClock(t.endAt, snap.timezone) : formatClockWithDate(t.endAt, snap.timezone, snap.localDate)}`;
      }
      return text;
    })
    .join(' · ');
}

/** Day Finder: "9:00 AM–12:00 PM"; carries dates only when the block crosses midnight. */
export function blockTimeLabel(block: DayFinderBlock, snap: Pick<BriefingSnapshot, 'timezone' | 'localDate'>): string {
  if (block.allDay) return 'All day';
  const start = block.startsBefore
    ? `${formatShortDate(dateKeyOf(block.startAt, snap.timezone))}, ${formatClock(block.startAt, snap.timezone)}`
    : formatClock(block.startAt, snap.timezone);
  if (!block.endAt) return start;
  const end = block.endsAfter
    ? `${formatShortDate(dateKeyOf(new Date(new Date(block.endAt).getTime() - 1), snap.timezone))}, ${formatClock(block.endAt, snap.timezone)}`
    : formatClock(block.endAt, snap.timezone);
  return `${start}–${end}`;
}

export function isEmptyFor(channel: 'email' | 'telegram', snap: BriefingSnapshot): boolean {
  const base = snap.tasks.length === 0 && snap.content.length === 0;
  return channel === 'email' ? base && snap.dayFinder.length === 0 : base;
}
