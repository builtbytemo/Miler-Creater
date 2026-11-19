import { describe, expect, it } from 'vitest';
import { matchesContentDate, sortContentChronologically } from '../src/lib/content/content-view';
import { formatRelativeDayLabel, getNextDayDate, getPrevDayDate } from '../src/lib/temporal/calendar';
import type { ContentItemWithMeta } from '../src/lib/services/content-service';

const content = (overrides: Partial<ContentItemWithMeta> = {}) =>
  ({
    id: 'c1',
    workspace_id: 'w1',
    social_account_id: null,
    platform: 'x',
    action_type: 'post',
    status: 'scheduled',
    title: 'Sample',
    body: 'Body',
    scheduled_at: null,
    duration_minutes: null,
    media_urls: [],
    external_links: [],
    target_reference: null,
    tags: [],
    notes: null,
    project_id: null,
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }) as ContentItemWithMeta;

describe('Content date filters and chronological sorting', () => {
  it('matches all items when filter is all', () => {
    expect(matchesContentDate(content(), 'all', '2026-11-05', 'Africa/Cairo')).toBe(true);
    expect(
      matchesContentDate(content({ scheduled_at: '2026-11-10T09:00:00Z' }), 'all', '2026-11-05', 'Africa/Cairo')
    ).toBe(true);
  });

  it('uses the workspace timezone across midnight for Today and excludes unscheduled items', () => {
    expect(
      matchesContentDate(content({ scheduled_at: '2026-11-04T23:30:00Z' }), 'today', '2026-11-05', 'Africa/Cairo')
    ).toBe(true);
    expect(
      matchesContentDate(content({ scheduled_at: '2026-11-05T23:30:00Z' }), 'today', '2026-11-05', 'Africa/Cairo')
    ).toBe(false);
    expect(matchesContentDate(content({ scheduled_at: null }), 'today', '2026-11-05', 'Africa/Cairo')).toBe(false);
  });

  it('sorts scheduled items earliest-first and places unscheduled items after (newest created_at first)', () => {
    const input = [
      content({ id: 'unsched-old', scheduled_at: null, created_at: '2026-11-01T08:00:00Z' }),
      content({ id: 'later', scheduled_at: '2026-11-05T15:00:00Z' }),
      content({ id: 'earlier', scheduled_at: '2026-11-05T08:00:00Z' }),
      content({ id: 'unsched-new', scheduled_at: null, created_at: '2026-11-03T08:00:00Z' }),
    ];

    const sorted = sortContentChronologically(input);
    expect(sorted.map((i) => i.id)).toEqual(['earlier', 'later', 'unsched-new', 'unsched-old']);
    expect(input[0].id).toBe('unsched-old');
  });

  it('formats relative day labels for Today, Yesterday, Tomorrow, and other dates', () => {
    const today = new Date('2026-11-05T10:00:00Z');
    const tz = 'Africa/Cairo';
    expect(formatRelativeDayLabel(today, today, tz)).toBe('Today');
    expect(formatRelativeDayLabel(getPrevDayDate(today, tz), today, tz)).toBe('Yesterday');
    expect(formatRelativeDayLabel(getNextDayDate(today, tz), today, tz)).toBe('Tomorrow');
    expect(formatRelativeDayLabel(getNextDayDate(getNextDayDate(today, tz), tz), today, tz)).toBe('Nov 7');
  });
});
