# Content Schedule Time & AM/PM Picker Design

## Intent & Why
Replace the browser-native `<input type="datetime-local">` in content creation and editing with an explicit date picker, 12-hour time dropdowns, and AM/PM toggle so users can always choose a post time and explicitly select AM or PM regardless of browser or OS locale.

## Goals & Non-Goals
- **Goals:**
  - Allow choosing a date, hour (`1`–`12`), minute (`00`–`55` in 5-minute increments, or any existing minute when editing), and `AM` / `PM` in both `CreateContentModal` and `ContentDetailModal`.
  - Preserve existing timezone conversion (`toLocalDatetimeString` / `parseLocalDatetimeString`), `scheduled` status auto-switching on create, and clearing/unscheduling (`""`).
- **Non-Goals:**
  - Changing database schema, server actions, or validation schemas (`scheduled_at` remains a UTC ISO 8601 string).
  - Changing task/calendar-block modals (`CreateTaskModal`, `TaskDetailModal`).

## Approaches Considered
1. **Shared `ScheduleDateTimePicker` with `<input type="date">`, Hour/Minute `<select>`s, and AM/PM segmented toggle (Selected):** Mouse-friendly, prevents invalid time strings, makes AM/PM explicit in every browser, and reuses the existing `YYYY-MM-DDTHH:mm` format internally.
2. **Date picker + typed 12-hour text input + AM/PM toggle:** Faster for arbitrary minute entry (e.g., `9:17`), but requires input masking/validation and is less consistent with the existing select-heavy modal forms.

## Design & Behavior
- **Shared Component (`src/components/content/ScheduleDateTimePicker.tsx`):**
  - Accepts `value: string` (`YYYY-MM-DDTHH:mm` or `""`), `onChange: (nextValue: string) => void`, optional `id` / `className` / `disabled`.
  - Pure conversion helpers convert between `YYYY-MM-DDTHH:mm` (24h) and `{ date, hour12, minute, meridiem: 'AM' | 'PM' }`:
    - `00:xx` → `12:xx AM`, `12:xx` → `12:xx PM`, `13:xx–23:xx` → `1–11 PM`.
    - When a user picks a date while time is unset, defaults to `09:00 AM` (`09:00`).
    - When a user clears the date, emits `""` (unscheduled).
    - If an existing item has a non-5-minute value (e.g., `14:23`), includes that minute option in the minute `<select>` so editing doesn't silently alter it.
- **Integration:**
  - `CreateContentModal.tsx` and `ContentDetailModal.tsx` replace `<input type="datetime-local">` with `<ScheduleDateTimePicker>`.
  - `CreateContentModal.tsx` keeps its existing behavior of switching `status` from `'idea'` to `'scheduled'` when a schedule is set.

## Testing
- Unit tests for 12h ↔ 24h conversion edge cases (`12:00 AM`, `12:00 PM`, `1:05 PM`, `11:55 PM`, non-5-minute preservation, empty/clear handling).
- Component render tests verifying `CreateContentModal` and `ContentDetailModal` render the date, hour, minute, and AM/PM controls without `datetime-local`.
