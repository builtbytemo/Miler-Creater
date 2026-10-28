# Recurrence Model Architecture & Specification

## 1. Executive Summary & Strategy Decision

A central architectural decision in designing task and scheduled content recurrence is determining **when** and **how** recurring occurrences are generated.

### Evaluation of Approaches

| Approach | Mechanics | Advantages | Disadvantages | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **A. Eager Pre-Generation** | Generate 50–365 concrete task rows in the database in advance upon rule creation. | Calendar queries are standard table selects without dynamic date logic. | 1. Severe database row bloat.<br>2. Changing or cancelling a recurrence rule requires bulk mutation/deletion of phantom rows.<br>3. Completing a task earlier or later desynchronizes future dates.<br>4. Reminders fire on phantom tasks. | **Rejected** |
| **B. Pure JIT Virtual Expansion** | Never generate future database rows. Calculate occurrences dynamically on-the-fly when querying calendar ranges. | Zero database row bloat. Recurrence rule changes take effect immediately everywhere. | 1. Storing completion history requires a secondary "exceptions" table.<br>2. Cannot easily attach subtasks, comments, or dependencies to a specific future occurrence before completing the current one. | **Rejected for Task Engine** (Kept for calendar projection only) |
| **C. Hybrid Next-Occurrence Generation + Virtual Calendar Projection (Selected)** | 1. Active task exists as exactly **one** concrete row.<br>2. When completed, the current task is marked `done` (preserving completion history, timestamps, subtasks, notes).<br>3. The engine atomically generates the **next** upcoming occurrence.<br>4. For calendar/scheduling range views, the service virtually projects upcoming dates without database mutation. | 1. Zero phantom database rows.<br>2. Complete historical ledger of every completed occurrence.<br>3. Future calendar range views see all future occurrences without cluttering the active task list.<br>4. Zero risk of runaway duplicates on retries. | **APPROVED & IMPLEMENTED** |

---

## 2. Temporal Semantics & Timezone Handling

### 2.1. Wall-Clock Stability Across Daylight Saving Time (DST)
Egypt (`Asia/Cairo`, canonical `Africa/Cairo`) observes Daylight Saving Time:
- **Standard Time (Winter)**: UTC+2 (October through April)
- **Daylight Time (Summer)**: UTC+3 (April through October)

**Rule**: A task scheduled for `09:00 AM Cairo time` must remain at `09:00 AM Cairo time` after a DST transition. It must **not** silently shift to `08:00 AM` or `10:00 AM` due to naive UTC timestamp addition.

**Implementation**:
1. Recurrence calculations decompose the reference date into local wall-clock components `(year, month, day, hour, minute)` using the rule's configured `timezone`.
2. The cadence interval is added in the local calendar domain:
   - Daily: $+ N \text{ days}$
   - Weekly: Next matching weekday in `by_weekday`
   - Monthly: $+ N \text{ months}$ on `by_monthday`
3. The resulting local wall-clock target is converted back to UTC `TIMESTAMPTZ` taking into account the exact DST offset applicable on that target date.

### 2.2. Month Boundary Edge Cases
- When a monthly task is set for the **31st**, months with fewer days (e.g. February with 28/29 days, or April with 30 days) clamp to the **last valid day of the month** (e.g. February 28, April 30).

### 2.3. Idempotency & Duplicate Prevention
- When completing a recurring task:
  1. The transaction checks if an active task (`status != 'done' AND status != 'cancelled'`) linked to the same `recurrence_rule_id` already exists.
  2. If an active occurrence already exists, no duplicate is created.
  3. The next occurrence inherits the project, milestone, priority, tags, duration, and subtask templates of the recurring task.
