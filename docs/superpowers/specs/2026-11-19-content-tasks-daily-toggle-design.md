# Content & Tasks Daily Toggle and Chronological Order Design

## Intent & Why
Make both **Content** and **Tasks** focus by default on what is assigned for **Today** (with a one-click toggle to see **All**), and order items chronologically from earliest to latest so the user can work through their day in time order instead of scanning an unsorted backlog.

## Goals
- Add a `Today | All` toggle to `ContentWorkspace`, defaulting to `Today` (unless deep-linked via `initialContentId` or a non-scheduled tab like `ideas`/`drafts`/`archived`).
- Default `TaskWorkspace`'s existing date filter (`Today | Any date | Overdue | No date`) to `Today` (unless `initialDateFilter` or `initialTaskId` is provided).
- Make chronological ascending order (earliest assigned time first, unscheduled/undated items after) the default sort in both Content and Tasks.
- Keep all filtering/sorting timezone-aware using `userTimeZone` and `getCalendarDateKey`.

## Non-Goals & Anti-Goals
- No date-picker or multi-day stepper (strictly Today vs. All as requested).
- No server-side query changes or URL round-trips on toggle clicks.
- Do not break deep links (`initialContentId`, `initialTaskId`, `initialDateFilter`, `initialTab`) or existing task filters (`Overdue`, `No date`, priority, project, status).

## Constraints
- Must respect `userTimeZone` for determining "Today".
- Must preserve existing Content tabs (`All Content`, `Idea Inbox`, `Drafts`, `Scheduled`, `Archived`) and Tasks status/date filters.
- In Content, when `Today` is active, match non-archived items whose `scheduled_at` falls on `todayKey` in `userTimeZone` (note: unscheduled tabs like `Idea Inbox` or `Drafts` have no `scheduled_at`, so switching to `Today` should work cleanly or reset/switch as appropriate—specifically, `Today` filters to items scheduled today; if the user switches to `Idea Inbox` or `Drafts` or creates an unscheduled item, the day filter switches to `all` so unscheduled items remain visible).

## Approaches Considered
1. **Client-side view helpers + workspace toggles (Chosen):** Add `src/lib/content/content-view.ts` (mirroring `src/lib/tasks/task-view.ts`) and update `task-view.ts`, `ContentWorkspace.tsx`, and `TaskWorkspace.tsx`. Instant UI updates, zero network latency, easy to unit test.
2. **URL-driven server filtering & sorting (Rejected):** Pushing query params and re-fetching from Supabase on every toggle adds latency and splits timezone logic.

## Design Details
- **`src/lib/content/content-view.ts`:**
  - `ContentDateFilter = 'today' | 'all'`
  - `matchesContentDate(item, filter, todayKey, timeZone)`: returns `true` for `'all'`; for `'today'`, returns `Boolean(item.scheduled_at && getCalendarDateKey(item.scheduled_at, timeZone) === todayKey)`.
  - `sortContentChronologically(items)`: sorts by `scheduled_at` ascending (earliest first); items without `scheduled_at` come after scheduled items, ordered by `created_at` descending.
- **`src/lib/tasks/task-view.ts`:**
  - Update `sortTaskView` so `'default'` (and `'due'`) sorts chronologically by assigned time (`scheduled_start ?? due_date` ascending, earliest first; undated tasks after). Keep `'priority'` and `'newest'` working as before.
- **`src/components/content/ContentWorkspace.tsx`:**
  - Add `dateFilter` state defaulting to `'today'` (or `'all'` if `initialContentId` is present or `initialTab` is `'ideas' | 'drafts' | 'archived'`).
  - Render a `Today | All` segmented toggle in the filter bar (matching `TaskWorkspace`'s segmented control style).
  - Switching to unscheduled-only tabs (`ideas`, `drafts`, `archived`) sets `dateFilter` to `'all'`; creating a new unscheduled item sets `dateFilter` to `'all'` (while creating a scheduled item for today keeps `'today'`).
  - Apply `matchesContentDate` and `sortContentChronologically` in `displayedItems`.
- **`src/components/tasks/TaskWorkspace.tsx`:**
  - Default `dateFilter` to `'today'` unless `initialDateFilter` is valid or `initialTaskId` is provided (in which case `'all'` ensures the linked task is visible).
  - Put `Today` first in the date segmented control (`Today | Any date | Overdue | No date`), and update the default sort option label to reflect chronological order (`Time: earliest first`).

## Left to the Builder
- Exact CSS/spacing alignment of the `Today | All` segmented control in `ContentWorkspace.tsx`.
- Unit and component tests covering `content-view.ts`, `task-view.ts`, `ContentWorkspace`, and `TaskWorkspace`.
