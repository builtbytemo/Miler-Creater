'use client';

import React from 'react';

export type Meridiem = 'AM' | 'PM';

export interface ParsedScheduleParts {
  date: string;
  hour12: string;
  minute: string;
  meridiem: Meridiem;
}

const DEFAULT_PARTS: ParsedScheduleParts = {
  date: '',
  hour12: '9',
  minute: '00',
  meridiem: 'AM',
};

const HOUR_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
const BASE_MINUTE_OPTIONS = [
  '00',
  '05',
  '10',
  '15',
  '20',
  '25',
  '30',
  '35',
  '40',
  '45',
  '50',
  '55',
] as const;

/**
 * Parses a local `YYYY-MM-DDTHH:mm` string into date, 12-hour hour, minute, and AM/PM parts.
 * Returns empty date with 09:00 AM defaults when unset or invalid.
 */
export function parseScheduleValue(value: string): ParsedScheduleParts {
  if (!value) return { ...DEFAULT_PARTS };
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return { ...DEFAULT_PARTS };

  const [, date, hourStr, minuteStr] = match;
  const hour24 = Number.parseInt(hourStr, 10);
  const minuteNum = Number.parseInt(minuteStr, 10);

  if (
    Number.isNaN(hour24) ||
    hour24 < 0 ||
    hour24 > 23 ||
    Number.isNaN(minuteNum) ||
    minuteNum < 0 ||
    minuteNum > 59
  ) {
    return { ...DEFAULT_PARTS };
  }

  const meridiem: Meridiem = hour24 >= 12 ? 'PM' : 'AM';
  const hour12Num = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return {
    date,
    hour12: String(hour12Num),
    minute: String(minuteNum).padStart(2, '0'),
    meridiem,
  };
}

/**
 * Formats date, 12-hour hour, minute, and AM/PM parts back into a `YYYY-MM-DDTHH:mm` string.
 * Returns `""` when no date is selected.
 */
export function formatScheduleValue(parts: ParsedScheduleParts): string {
  if (!parts.date) return '';

  const hour12Num = Number.parseInt(parts.hour12, 10);
  const minuteNum = Number.parseInt(parts.minute, 10);
  if (
    Number.isNaN(hour12Num) ||
    hour12Num < 1 ||
    hour12Num > 12 ||
    Number.isNaN(minuteNum) ||
    minuteNum < 0 ||
    minuteNum > 59
  ) {
    return '';
  }

  let hour24 = hour12Num % 12;
  if (parts.meridiem === 'PM') {
    hour24 += 12;
  }

  const hh = String(hour24).padStart(2, '0');
  const mm = String(minuteNum).padStart(2, '0');
  return `${parts.date}T${hh}:${mm}`;
}

interface ScheduleDateTimePickerProps {
  id?: string;
  value: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  className?: string;
}

const fieldBaseClass =
  'rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2.5 py-2 text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--border-strong)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

/**
 * Explicit date + 12-hour time (hour/minute selects) + AM/PM toggle picker
 * backed by a `YYYY-MM-DDTHH:mm` local datetime string.
 */
export function ScheduleDateTimePicker({
  id,
  value,
  onChange,
  disabled = false,
  className = '',
}: ScheduleDateTimePickerProps) {
  const parts = parseScheduleValue(value);

  const minuteOptions = BASE_MINUTE_OPTIONS.includes(
    parts.minute as (typeof BASE_MINUTE_OPTIONS)[number]
  )
    ? [...BASE_MINUTE_OPTIONS]
    : [...BASE_MINUTE_OPTIONS, parts.minute].sort(
        (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)
      );

  const updateParts = (patch: Partial<ParsedScheduleParts>) => {
    const nextParts: ParsedScheduleParts = { ...parts, ...patch };
    onChange(formatScheduleValue(nextParts));
  };

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <input
        id={id}
        type="date"
        value={parts.date}
        disabled={disabled}
        onChange={(e) => updateParts({ date: e.target.value })}
        className={`w-full ${fieldBaseClass}`}
      />

      <div className="flex items-center gap-1.5">
        <select
          aria-label="Hour"
          value={parts.hour12}
          disabled={disabled || !parts.date}
          onChange={(e) => updateParts({ hour12: e.target.value })}
          className={`flex-1 min-w-0 ${fieldBaseClass}`}
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h.padStart(2, '0')}
            </option>
          ))}
        </select>

        <span className="text-xs font-mono text-[var(--text-muted)] select-none">:</span>

        <select
          aria-label="Minute"
          value={parts.minute}
          disabled={disabled || !parts.date}
          onChange={(e) => updateParts({ minute: e.target.value })}
          className={`flex-1 min-w-0 ${fieldBaseClass}`}
        >
          {minuteOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div
          role="group"
          aria-label="AM or PM"
          className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5 shrink-0"
        >
          {(['AM', 'PM'] as const).map((period) => {
            const isSelected = parts.meridiem === period;
            return (
              <button
                key={period}
                type="button"
                disabled={disabled || !parts.date}
                aria-pressed={isSelected}
                onClick={() => updateParts({ meridiem: period })}
                className={`px-2 py-1.5 text-[11px] font-semibold rounded-[calc(var(--radius-sm)-2px)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'bg-[var(--text-primary)] text-[var(--bg-canvas)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {period}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
