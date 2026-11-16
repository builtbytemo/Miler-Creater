import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parseScheduleValue,
  formatScheduleValue,
  ScheduleDateTimePicker,
} from '../src/components/content/ScheduleDateTimePicker';

vi.mock('@/lib/actions/content-actions', () => ({
  createContentItemAction: vi.fn(),
  updateContentItemAction: vi.fn(),
  deleteContentItemAction: vi.fn(),
  archiveContentItemAction: vi.fn(),
  unarchiveContentItemAction: vi.fn(),
}));

import { CreateContentModal } from '../src/components/content/CreateContentModal';

describe('ScheduleDateTimePicker conversion helpers', () => {
  it('defaults empty value to empty date and 09:00 AM', () => {
    expect(parseScheduleValue('')).toEqual({
      date: '',
      hour12: '9',
      minute: '00',
      meridiem: 'AM',
    });
    expect(
      formatScheduleValue({ date: '', hour12: '9', minute: '00', meridiem: 'AM' })
    ).toBe('');
  });

  it('converts midnight (00:xx) and noon (12:xx) accurately', () => {
    expect(parseScheduleValue('2026-11-17T00:05')).toEqual({
      date: '2026-11-17',
      hour12: '12',
      minute: '05',
      meridiem: 'AM',
    });
    expect(
      formatScheduleValue({ date: '2026-11-17', hour12: '12', minute: '05', meridiem: 'AM' })
    ).toBe('2026-11-17T00:05');

    expect(parseScheduleValue('2026-11-17T12:30')).toEqual({
      date: '2026-11-17',
      hour12: '12',
      minute: '30',
      meridiem: 'PM',
    });
    expect(
      formatScheduleValue({ date: '2026-11-17', hour12: '12', minute: '30', meridiem: 'PM' })
    ).toBe('2026-11-17T12:30');
  });

  it('converts afternoon/evening hours and preserves non-5-minute values', () => {
    expect(parseScheduleValue('2026-11-17T14:23')).toEqual({
      date: '2026-11-17',
      hour12: '2',
      minute: '23',
      meridiem: 'PM',
    });
    expect(
      formatScheduleValue({ date: '2026-11-17', hour12: '11', minute: '55', meridiem: 'PM' })
    ).toBe('2026-11-17T23:55');
  });
});

describe('ScheduleDateTimePicker rendering', () => {
  it('renders date input, hour/minute selects, and AM/PM toggle buttons without datetime-local', () => {
    const html = renderToStaticMarkup(
      <ScheduleDateTimePicker
        id="test-schedule"
        value="2026-11-17T14:23"
        onChange={() => {}}
      />
    );
    expect(html).not.toContain('datetime-local');
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-11-17"');
    expect(html).toContain('>AM<');
    expect(html).toContain('>PM<');
    expect(html).toContain('value="23"');
  });
});

describe('Content modal schedule integration', () => {
  it('CreateContentModal renders date, hour, minute, and AM/PM controls instead of datetime-local', () => {
    const html = renderToStaticMarkup(
      <CreateContentModal
        workspaceId="ws-1"
        isOpen={true}
        onClose={() => {}}
        onContentCreated={() => {}}
        initialScheduledAt="2026-11-17T15:45:00.000Z"
        userTimeZone="UTC"
      />
    );
    expect(html).not.toContain('datetime-local');
    expect(html).toContain('type="date"');
    expect(html).toContain('aria-label="Hour"');
    expect(html).toContain('aria-label="Minute"');
    expect(html).toContain('>AM<');
    expect(html).toContain('>PM<');
  });

  it('CreateContentModal and ContentDetailModal both use ScheduleDateTimePicker and drop datetime-local', () => {
    const createSource = readFileSync(
      join(process.cwd(), 'src/components/content/CreateContentModal.tsx'),
      'utf8'
    );
    const detailSource = readFileSync(
      join(process.cwd(), 'src/components/content/ContentDetailModal.tsx'),
      'utf8'
    );
    expect(createSource).toContain('ScheduleDateTimePicker');
    expect(createSource).not.toContain('type="datetime-local"');
    expect(detailSource).toContain('ScheduleDateTimePicker');
    expect(detailSource).not.toContain('type="datetime-local"');
  });
});
