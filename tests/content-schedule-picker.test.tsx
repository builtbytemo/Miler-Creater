import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parseScheduleValue,
  formatScheduleValue,
  ScheduleDateTimePicker,
} from '../src/components/content/ScheduleDateTimePicker';

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
