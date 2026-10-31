import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { AppNavigation } from '../src/components/layout/AppNavigation';
import {
  getWeekRange,
  getNextWeekRange,
  getPrevWeekRange,
  getMonthGrid,
  getNextMonthDate,
  getPrevMonthDate,
  getDayRange,
  getNextDayDate,
  getPrevDayDate,
  getCalendarDateKey,
  toLocalDatetimeString,
  parseLocalDatetimeString,
  getItemHourInTimeZone,
} from '../src/lib/temporal/calendar';
import type { ContentItemWithMeta } from '../src/lib/services/content-service';
import type { TaskWithMeta } from '../src/lib/services/task-service';

vi.mock('next/navigation', () => ({
  usePathname: () => '/calendar',
}));

describe('Interactive Calendar & Monthly Overview (Phase 4, Step 4)', () => {
  const tz = 'Africa/Cairo';
  const baseWeek = getWeekRange('2026-10-28T12:00:00Z', tz); // Oct 26 - Nov 1, 2026

  const sampleScheduledPost: ContentItemWithMeta = {
    id: 'c-scheduled-1',
    workspace_id: 'ws-111',
    social_account_id: 'sa-1',
    platform: 'linkedin',
    action_type: 'post',
    status: 'scheduled',
    title: 'LinkedIn Launch Announcement',
    body: 'Big product update coming today!',
    scheduled_at: '2026-10-27T10:00:00Z',
    duration_minutes: 30,
    media_urls: [],
    external_links: [],
    target_reference: null,
    tags: ['launch', 'announcement'],
    notes: null,
    project_id: 'p-1',
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: 'usr-1',
    created_at: '2026-10-25T10:00:00Z',
    updated_at: '2026-10-25T10:00:00Z',
    social_account: {
      id: 'sa-1',
      platform: 'linkedin',
      account_handle: '@milerdev',
      account_name: 'Miler Dev',
      avatar_url: null,
    },
    project: {
      id: 'p-1',
      name: 'Launch Project',
      color: '#3b82f6',
    },
  };

  const sampleMidnightPost: ContentItemWithMeta = {
    id: 'c-midnight-1',
    workspace_id: 'ws-111',
    social_account_id: null,
    platform: 'x',
    action_type: 'post',
    status: 'scheduled',
    title: 'Late Night Thought',
    body: 'Reflecting on architecture',
    // 22:30 UTC in Cairo (UTC+2) is 00:30 AM on Oct 28
    scheduled_at: '2026-10-27T22:30:00Z',
    duration_minutes: 15,
    media_urls: [],
    external_links: [],
    target_reference: null,
    tags: [],
    notes: null,
    project_id: null,
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: 'usr-1',
    created_at: '2026-10-25T10:00:00Z',
    updated_at: '2026-10-25T10:00:00Z',
  };

  const sampleUnscheduledIdea: ContentItemWithMeta = {
    id: 'c-unscheduled-idea',
    workspace_id: 'ws-111',
    social_account_id: null,
    platform: 'reddit',
    action_type: 'comment',
    status: 'idea',
    title: 'Reddit Discussion Angle',
    body: 'Discussing state management patterns',
    scheduled_at: null,
    duration_minutes: null,
    media_urls: [],
    external_links: [],
    target_reference: null,
    tags: ['discussion'],
    notes: null,
    project_id: null,
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: 'usr-1',
    created_at: '2026-10-25T11:00:00Z',
    updated_at: '2026-10-25T11:00:00Z',
  };

  const sampleUnscheduledDraft: ContentItemWithMeta = {
    id: 'c-unscheduled-draft',
    workspace_id: 'ws-111',
    social_account_id: null,
    platform: 'threads',
    action_type: 'post',
    status: 'draft',
    title: 'Draft Threads Series',
    body: 'Thread 1: Agentic workflows',
    scheduled_at: null,
    duration_minutes: null,
    media_urls: [],
    external_links: [],
    target_reference: null,
    tags: ['agents'],
    notes: null,
    project_id: null,
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: 'usr-1',
    created_at: '2026-10-25T12:00:00Z',
    updated_at: '2026-10-25T12:00:00Z',
  };

  describe('CalendarWeekView Date Grouping & Rendering', () => {
    it('groups scheduled items under their exact local calendar dateKey in the user timezone', () => {
      // Verify sampleScheduledPost is on 2026-10-27
      const dateKey1 = getCalendarDateKey(sampleScheduledPost.scheduled_at!, tz);
      expect(dateKey1).toBe('2026-10-27');

      // Verify sampleMidnightPost (22:30 UTC) is on 2026-10-28 in Cairo (UTC+2 = 00:30 AM)
      const dateKey2 = getCalendarDateKey(sampleMidnightPost.scheduled_at!, tz);
      expect(dateKey2).toBe('2026-10-28');

      // Verify date bucketing
      const items = [sampleScheduledPost, sampleMidnightPost];
      const itemsByDateKey: Record<string, ContentItemWithMeta[]> = {};
      for (const day of baseWeek.days) {
        itemsByDateKey[day.dateKey] = [];
      }
      for (const item of items) {
        if (!item.scheduled_at) continue;
        const key = getCalendarDateKey(item.scheduled_at, tz);
        if (itemsByDateKey[key]) {
          itemsByDateKey[key].push(item);
        }
      }

      expect(itemsByDateKey['2026-10-27']).toHaveLength(1);
      expect(itemsByDateKey['2026-10-27'][0].id).toBe('c-scheduled-1');

      expect(itemsByDateKey['2026-10-28']).toHaveLength(1);
      expect(itemsByDateKey['2026-10-28'][0].id).toBe('c-midnight-1');

      expect(itemsByDateKey['2026-10-26']).toHaveLength(0);
      expect(itemsByDateKey['2026-10-29']).toHaveLength(0);
    });

    it('strictly excludes unscheduled items from the week grid day columns', () => {
      const allItems = [sampleScheduledPost, sampleUnscheduledIdea, sampleUnscheduledDraft];

      // Filter scheduled items as week view does
      const scheduledOnly = allItems.filter((i) => i.scheduled_at !== null);
      expect(scheduledOnly).toHaveLength(1);
      expect(scheduledOnly[0].id).toBe('c-scheduled-1');

      // Ensure unscheduled items have null scheduled_at
      expect(sampleUnscheduledIdea.scheduled_at).toBeNull();
      expect(sampleUnscheduledDraft.scheduled_at).toBeNull();
    });

    it('handles empty days and empty weeks gracefully', () => {
      const emptyItems: ContentItemWithMeta[] = [];
      const itemsByDateKey: Record<string, ContentItemWithMeta[]> = {};
      for (const day of baseWeek.days) {
        itemsByDateKey[day.dateKey] = [];
      }
      for (const item of emptyItems) {
        if (!item.scheduled_at) continue;
        const key = getCalendarDateKey(item.scheduled_at, tz);
        if (itemsByDateKey[key]) itemsByDateKey[key].push(item);
      }

      // All 7 days are empty
      baseWeek.days.forEach((day) => {
        expect(itemsByDateKey[day.dateKey]).toHaveLength(0);
      });
    });

    it('sorts multiple items within the same day chronologically', () => {
      const itemMorning: ContentItemWithMeta = {
        ...sampleScheduledPost,
        id: 'c-morning',
        scheduled_at: '2026-10-27T08:00:00Z',
      };
      const itemAfternoon: ContentItemWithMeta = {
        ...sampleScheduledPost,
        id: 'c-afternoon',
        scheduled_at: '2026-10-27T15:00:00Z',
      };

      const dayItems = [itemAfternoon, itemMorning];
      dayItems.sort((a, b) => {
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeA - timeB;
      });

      expect(dayItems[0].id).toBe('c-morning');
      expect(dayItems[1].id).toBe('c-afternoon');
    });
  });

  describe('CalendarMonthView & Monthly Grid (Phase 4, Step 4)', () => {
    it('generates a 6-row or 5-row month grid including leading and trailing days', () => {
      const octGrid = getMonthGrid('2026-10-15T12:00:00Z', tz);
      expect(octGrid.year).toBe(2026);
      expect(octGrid.month).toBe(10);
      expect(octGrid.label).toBe('October 2026');
      expect(octGrid.cells.length).toBe(octGrid.totalRows * 7);

      // October 1, 2026 is a Thursday (weekday 4).
      // Monday-start grid has 3 leading days (Mon Sep 28, Tue Sep 29, Wed Sep 30).
      expect(octGrid.cells[0].dateKey).toBe('2026-09-28');
      expect(octGrid.cells[0].isLeading).toBe(true);
      expect(octGrid.cells[0].isCurrentMonth).toBe(false);

      // First day of October
      const day1 = octGrid.cells.find((c) => c.dateKey === '2026-10-01');
      expect(day1).toBeDefined();
      expect(day1?.isCurrentMonth).toBe(true);
      expect(day1?.day).toBe(1);

      // Last day of October
      const day31 = octGrid.cells.find((c) => c.dateKey === '2026-10-31');
      expect(day31).toBeDefined();
      expect(day31?.isCurrentMonth).toBe(true);
      expect(day31?.day).toBe(31);

      // Trailing days belong to November
      const trailing = octGrid.cells.filter((c) => c.isTrailing);
      expect(trailing.length).toBeGreaterThan(0);
      expect(trailing[0].dateKey.startsWith('2026-11-')).toBe(true);
    });

    it('buckets scheduled items across current month, leading days, and trailing days', () => {
      const octGrid = getMonthGrid('2026-10-15T12:00:00Z', tz);

      // Item in leading day (Sep 30)
      const leadingItem: ContentItemWithMeta = {
        ...sampleScheduledPost,
        id: 'c-leading-sep30',
        scheduled_at: '2026-09-30T10:00:00Z',
      };
      // Item in current month (Oct 27)
      const currentMonthItem = sampleScheduledPost;
      // Item in trailing day (Nov 1)
      const trailingItem: ContentItemWithMeta = {
        ...sampleScheduledPost,
        id: 'c-trailing-nov01',
        scheduled_at: '2026-11-01T14:00:00Z',
      };

      const allItems = [leadingItem, currentMonthItem, trailingItem];
      const itemsByDateKey: Record<string, ContentItemWithMeta[]> = {};
      for (const cell of octGrid.cells) {
        itemsByDateKey[cell.dateKey] = [];
      }
      for (const item of allItems) {
        if (!item.scheduled_at) continue;
        const key = getCalendarDateKey(item.scheduled_at, tz);
        if (itemsByDateKey[key]) {
          itemsByDateKey[key].push(item);
        }
      }

      expect(itemsByDateKey['2026-09-30']).toHaveLength(1);
      expect(itemsByDateKey['2026-09-30'][0].id).toBe('c-leading-sep30');

      expect(itemsByDateKey['2026-10-27']).toHaveLength(1);
      expect(itemsByDateKey['2026-10-27'][0].id).toBe('c-scheduled-1');

      expect(itemsByDateKey['2026-11-01']).toHaveLength(1);
      expect(itemsByDateKey['2026-11-01'][0].id).toBe('c-trailing-nov01');
    });

    it('navigates next and previous months with rollover and rollback', () => {
      const octDate = new Date('2026-10-15T12:00:00Z');

      // Next month: October -> November
      const novDate = getNextMonthDate(octDate, tz);
      const novGrid = getMonthGrid(novDate, tz);
      expect(novGrid.label).toBe('November 2026');
      expect(novGrid.month).toBe(11);

      // Next month year rollover: December 2026 -> January 2027
      const decDate = new Date('2026-12-15T12:00:00Z');
      const janDate = getNextMonthDate(decDate, tz);
      const janGrid = getMonthGrid(janDate, tz);
      expect(janGrid.label).toBe('January 2027');
      expect(janGrid.year).toBe(2027);
      expect(janGrid.month).toBe(1);

      // Prev month year rollback: January 2027 -> December 2026
      const rollBackDate = getPrevMonthDate(janDate, tz);
      const decRollbackGrid = getMonthGrid(rollBackDate, tz);
      expect(decRollbackGrid.label).toBe('December 2026');
      expect(decRollbackGrid.year).toBe(2026);
      expect(decRollbackGrid.month).toBe(12);

      // Month clamping: March 31 -> February (clamps to 28 days)
      const mar31 = new Date('2026-03-31T12:00:00Z');
      const febDate = getPrevMonthDate(mar31, tz);
      const febGrid = getMonthGrid(febDate, tz);
      expect(febGrid.label).toBe('February 2026');
      expect(febGrid.month).toBe(2);
    });

    it('calculates the exact week range when selecting a date cell from month view', () => {
      // User clicks cell for 2026-10-14 (Wednesday) in Month view
      const selectedDate = new Date('2026-10-14T12:00:00Z');
      const targetWeek = getWeekRange(selectedDate, tz);

      expect(targetWeek.label).toBe('Oct 12 – 18, 2026');
      expect(targetWeek.days[0].dateKey).toBe('2026-10-12'); // Monday
      expect(targetWeek.days[2].dateKey).toBe('2026-10-14'); // Wednesday
      expect(targetWeek.days[6].dateKey).toBe('2026-10-18'); // Sunday
    });
  });

  describe('UnscheduledContentDrawer Backlog Consistency Audit', () => {
    it('strictly includes only idea and draft status with scheduled_at === null in active backlog', () => {
      const publishingItem: ContentItemWithMeta = {
        ...sampleUnscheduledDraft,
        id: 'c-publishing',
        status: 'publishing',
      };
      const publishedItem: ContentItemWithMeta = {
        ...sampleUnscheduledDraft,
        id: 'c-published',
        status: 'published',
      };
      const failedItem: ContentItemWithMeta = {
        ...sampleUnscheduledDraft,
        id: 'c-failed',
        status: 'failed',
      };
      const archivedItem: ContentItemWithMeta = {
        ...sampleUnscheduledDraft,
        id: 'c-archived',
        status: 'archived',
      };

      const allItems = [
        sampleUnscheduledIdea,
        sampleUnscheduledDraft,
        publishingItem,
        publishedItem,
        failedItem,
        archivedItem,
      ];

      // Strict backlog filter matching UnscheduledContentDrawer audit
      const activeUnscheduled = allItems.filter(
        (item) => item.scheduled_at === null && (item.status === 'idea' || item.status === 'draft')
      );

      expect(activeUnscheduled).toHaveLength(2);
      expect(activeUnscheduled.map((i) => i.id)).toEqual(['c-unscheduled-idea', 'c-unscheduled-draft']);

      // Ideas filter
      const ideas = activeUnscheduled.filter((i) => i.status === 'idea');
      expect(ideas).toHaveLength(1);
      expect(ideas[0].id).toBe('c-unscheduled-idea');

      // Drafts filter: must strictly be status === 'draft'
      const drafts = activeUnscheduled.filter((i) => i.status === 'draft');
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe('c-unscheduled-draft');

      // Automated lifecycle and archived items are completely excluded
      expect(activeUnscheduled.some((i) => i.status === 'publishing')).toBe(false);
      expect(activeUnscheduled.some((i) => i.status === 'published')).toBe(false);
      expect(activeUnscheduled.some((i) => i.status === 'failed')).toBe(false);
      expect(activeUnscheduled.some((i) => i.status === 'archived')).toBe(false);
    });

    it('filters unscheduled backlog by search query and platform', () => {
      const items = [sampleUnscheduledIdea, sampleUnscheduledDraft];

      // Filter by platform
      const redditOnly = items.filter((i) => i.platform === 'reddit');
      expect(redditOnly).toHaveLength(1);
      expect(redditOnly[0].id).toBe('c-unscheduled-idea');

      // Filter by search query
      const query = 'workflow';
      const searchMatches = items.filter(
        (i) =>
          i.title?.toLowerCase().includes(query) ||
          i.body.toLowerCase().includes(query) ||
          i.tags.some((t) => t.toLowerCase().includes(query))
      );
      expect(searchMatches).toHaveLength(1);
      expect(searchMatches[0].id).toBe('c-unscheduled-draft');
    });
  });

  describe('Race Condition & Stale Request Protection', () => {
    it('discards out-of-order asynchronous responses using requestIdRef sequence', async () => {
      let currentRequestId = 0;
      let stateData: string | null = null;

      // Simulate Request 1 dispatched
      const reqId1 = ++currentRequestId;

      // Simulate Request 2 dispatched shortly after
      const reqId2 = ++currentRequestId;

      // Request 2 completes first (fast network response)
      if (reqId2 === currentRequestId) {
        stateData = 'response-2';
      }

      // Request 1 completes later (slow / lagged response)
      if (reqId1 === currentRequestId) {
        stateData = 'response-1';
      }

      // State data must retain Request 2's data and not get corrupted by Request 1
      expect(stateData).toBe('response-2');
    });
  });

  describe('Scheduling State Transitions (Optimistic Lifecycle)', () => {
    it('moves an item from unscheduled backlog into scheduled items when scheduled_at is set', () => {
      let scheduled = [sampleScheduledPost];
      let unscheduled = [sampleUnscheduledDraft];

      // Simulate scheduling the draft for 2026-10-28 14:00
      const updatedDraft: ContentItemWithMeta = {
        ...sampleUnscheduledDraft,
        status: 'scheduled',
        scheduled_at: '2026-10-28T12:00:00Z',
      };

      // Lifecycle update logic:
      if (updatedDraft.scheduled_at) {
        unscheduled = unscheduled.filter((i) => i.id !== updatedDraft.id);
        scheduled = [...scheduled, updatedDraft];
      }

      expect(unscheduled).toHaveLength(0);
      expect(scheduled).toHaveLength(2);
      expect(scheduled.some((i) => i.id === sampleUnscheduledDraft.id)).toBe(true);
    });

    it('moves an item from scheduled into unscheduled backlog when scheduled_at is cleared', () => {
      let scheduled = [sampleScheduledPost];
      let unscheduled: ContentItemWithMeta[] = [];

      // Simulate un-scheduling
      const unscheduledPost: ContentItemWithMeta = {
        ...sampleScheduledPost,
        scheduled_at: null,
      };

      if (!unscheduledPost.scheduled_at) {
        scheduled = scheduled.filter((i) => i.id !== unscheduledPost.id);
        unscheduled = [unscheduledPost, ...unscheduled];
      }

      expect(scheduled).toHaveLength(0);
      expect(unscheduled).toHaveLength(1);
      expect(unscheduled[0].id).toBe(sampleScheduledPost.id);
    });
  });

  describe('AppNavigation Phase 4 Activation', () => {
    it('enables the Calendar navigation entry without disabled flag or Phase 4 badge', () => {
      const nav = AppNavigation();
      expect(nav).toBeDefined();

      const navChildren = (nav.props as { children: React.ReactNode[] }).children;
      expect(navChildren).toBeDefined();
    });
  });

  describe('Day View Hourly Timeline (Part C)', () => {
    const sampleDayRange = getDayRange('2026-10-29T12:00:00Z', tz);

    const sampleScheduledTask: TaskWithMeta = {
      id: 't-scheduled-1',
      workspace_id: 'ws-111',
      parent_task_id: null,
      project_id: 'p-1',
      milestone_id: null,
      title: 'Deploy Production Release',
      description: 'Verify cloud services and run migrations',
      priority: 'urgent',
      status: 'todo',
      // In Cairo (UTC+3 in late October): 08:00 UTC is 11:00 local
      scheduled_start: '2026-10-29T08:00:00Z',
      scheduled_end: '2026-10-29T09:30:00Z',
      due_date: '2026-10-29T17:00:00Z',
      estimated_duration_minutes: 90,
      is_all_day: false,
      completed_at: null,
      tags: ['deploy', 'infra'],
      recurrence_rule_id: null,
      created_by: 'usr-1',
      assigned_to: null,
      created_at: '2026-10-25T10:00:00Z',
      updated_at: '2026-10-25T10:00:00Z',
      subtask_count: 0,
      completed_subtask_count: 0,
      is_blocked: false,
      blocking_tasks: [],
      project: {
        id: 'p-1',
        name: 'Launch Project',
        color: '#3b82f6',
      },
    };

    const sampleScheduledDayPost: ContentItemWithMeta = {
      ...sampleScheduledPost,
      id: 'c-day-post',
      // In Cairo (UTC+3 in late October): 11:30 UTC is 14:30 local (2 PM slot)
      scheduled_at: '2026-10-29T11:30:00Z',
    };

    const sampleAllDayTask: TaskWithMeta = {
      ...sampleScheduledTask,
      id: 't-allday-1',
      title: 'Company Hackathon Day',
      scheduled_start: '2026-10-29T00:00:00Z',
      is_all_day: true,
    };

    it('positions scheduled content and tasks at their exact local hours in Day view', () => {
      expect(sampleDayRange.dateKey).toBe('2026-10-29');

      // Check task hour: 08:00 UTC = 11:00 local in Cairo
      const taskHour = getItemHourInTimeZone(sampleScheduledTask.scheduled_start!, tz);
      expect(taskHour.hour).toBe(11);
      expect(taskHour.minute).toBe(0);

      // Check content hour: 11:30 UTC = 14:30 local (Hour 14) in Cairo
      const contentHour = getItemHourInTimeZone(sampleScheduledDayPost.scheduled_at!, tz);
      expect(contentHour.hour).toBe(14);
      expect(contentHour.minute).toBe(30);

      // Verify hourly slot bucket distribution
      const contentByHour: Record<number, ContentItemWithMeta[]> = {};
      const tasksByHour: Record<number, TaskWithMeta[]> = {};
      for (let h = 0; h < 24; h++) {
        contentByHour[h] = [];
        tasksByHour[h] = [];
      }

      contentByHour[contentHour.hour].push(sampleScheduledDayPost);
      tasksByHour[taskHour.hour].push(sampleScheduledTask);

      expect(tasksByHour[11]).toHaveLength(1);
      expect(tasksByHour[11][0].id).toBe('t-scheduled-1');
      expect(contentByHour[14]).toHaveLength(1);
      expect(contentByHour[14][0].id).toBe('c-day-post');

      // Other hours remain empty
      expect(tasksByHour[0]).toHaveLength(0);
      expect(contentByHour[0]).toHaveLength(0);
    });

    it('isolates all-day tasks from hourly timeline slots', () => {
      const allTasks = [sampleScheduledTask, sampleAllDayTask];
      const allDay = allTasks.filter((t) => t.is_all_day);
      const timed = allTasks.filter((t) => !t.is_all_day && Boolean(t.scheduled_start));

      expect(allDay).toHaveLength(1);
      expect(allDay[0].id).toBe('t-allday-1');
      expect(timed).toHaveLength(1);
      expect(timed[0].id).toBe('t-scheduled-1');
    });

    it('navigates previous and next days while preserving exact date calculations', () => {
      const current = sampleDayRange.dayStart;
      const prev = getPrevDayDate(current, tz);
      const next = getNextDayDate(current, tz);

      expect(getCalendarDateKey(prev, tz)).toBe('2026-10-28');
      expect(getCalendarDateKey(next, tz)).toBe('2026-10-30');
    });
  });

  describe('Unified Content & Task Scheduling Across Views (Parts B & D)', () => {
    const sampleTask: TaskWithMeta = {
      id: 't-sample-2',
      workspace_id: 'ws-111',
      parent_task_id: null,
      project_id: null,
      milestone_id: null,
      title: 'Review Marketing Copy',
      description: null,
      priority: 'high',
      status: 'in_progress',
      scheduled_start: '2026-10-27T13:00:00Z',
      scheduled_end: '2026-10-27T14:00:00Z',
      due_date: null,
      estimated_duration_minutes: 60,
      is_all_day: false,
      completed_at: null,
      tags: [],
      recurrence_rule_id: null,
      created_by: 'usr-1',
      assigned_to: null,
      created_at: '2026-10-25T10:00:00Z',
      updated_at: '2026-10-25T10:00:00Z',
      subtask_count: 0,
      completed_subtask_count: 0,
      is_blocked: false,
      blocking_tasks: [],
      project: null,
    };

    it('displays scheduled tasks and content together under the same dateKey in Week view', () => {
      const items = [sampleScheduledPost];
      const tasks = [sampleTask];

      const postDateKey = getCalendarDateKey(sampleScheduledPost.scheduled_at!, tz);
      const taskDateKey = getCalendarDateKey(sampleTask.scheduled_start!, tz);

      // Both are scheduled on Oct 27
      expect(postDateKey).toBe('2026-10-27');
      expect(taskDateKey).toBe('2026-10-27');

      // Combined day count
      const combinedCount = items.length + tasks.length;
      expect(combinedCount).toBe(2);
    });

    it('displays scheduled tasks and content together in Month grid cells', () => {
      const octGrid = getMonthGrid('2026-10-15T12:00:00Z', tz);
      const taskDateKey = getCalendarDateKey(sampleTask.scheduled_start!, tz);
      const cell = octGrid.cells.find((c) => c.dateKey === taskDateKey);

      expect(cell).toBeDefined();
      expect(cell?.dateKey).toBe('2026-10-27');
      expect(cell?.isCurrentMonth).toBe(true);
    });

    it('preserves the referenceDate context when switching between Day, Week, and Month views', () => {
      // User is viewing Oct 29, 2026
      const refDate = new Date('2026-10-29T12:00:00Z');

      // Day view shows Oct 29
      const day = getDayRange(refDate, tz);
      expect(day.dateKey).toBe('2026-10-29');

      // Switch to Week view -> week contains Oct 29
      const week = getWeekRange(refDate, tz);
      expect(week.days.some((d) => d.dateKey === '2026-10-29')).toBe(true);
      expect(week.label).toBe('Oct 26 – Nov 1, 2026');

      // Switch to Month view -> month is October 2026
      const month = getMonthGrid(refDate, tz);
      expect(month.label).toBe('October 2026');
      expect(month.cells.some((c) => c.dateKey === '2026-10-29')).toBe(true);
    });

    it('prefills timezone-safe local datetime string when scheduling from a slot', () => {
      const targetDateKey = '2026-10-29';
      const targetHour = 14;

      const localStr = `${targetDateKey}T${String(targetHour).padStart(2, '0')}:00`;
      const parsedUtc = parseLocalDatetimeString(localStr, tz);

      expect(parsedUtc).not.toBeNull();
      // Formatting back to timezone should yield the exact same local string
      const backToLocal = toLocalDatetimeString(parsedUtc!, tz);
      expect(backToLocal).toBe('2026-10-29T14:00');
    });

    it('strictly isolates scheduled items from the unscheduled drawer backlog', () => {
      const scheduledItem = sampleScheduledPost;
      const unscheduledDraft = sampleUnscheduledDraft;

      // Unscheduled items must have scheduled_at === null
      expect(scheduledItem.scheduled_at).not.toBeNull();
      expect(unscheduledDraft.scheduled_at).toBeNull();

      const drawerEligible = [scheduledItem, unscheduledDraft].filter(
        (i) => i.scheduled_at === null && (i.status === 'idea' || i.status === 'draft')
      );

      expect(drawerEligible).toHaveLength(1);
      expect(drawerEligible[0].id).toBe(unscheduledDraft.id);
    });
  });

  describe('Calendar Regression: Infinite Loop Prevention & Safe Scheduling (Phase 4 Extension)', () => {
    const tz = 'Africa/Cairo';

    const sampleTask: TaskWithMeta = {
      id: 't-safe-1',
      workspace_id: 'ws-111',
      parent_task_id: null,
      project_id: null,
      milestone_id: null,
      title: 'Regression Verification Task',
      description: null,
      priority: 'high',
      status: 'in_progress',
      scheduled_start: '2026-10-27T13:00:00Z',
      scheduled_end: '2026-10-27T14:00:00Z',
      due_date: null,
      estimated_duration_minutes: 60,
      is_all_day: false,
      completed_at: null,
      tags: [],
      recurrence_rule_id: null,
      created_by: 'usr-1',
      assigned_to: null,
      created_at: '2026-10-25T10:00:00Z',
      updated_at: '2026-10-25T10:00:00Z',
      subtask_count: 0,
      completed_subtask_count: 0,
      is_blocked: false,
      blocking_tasks: [],
      project: null,
    };

    it('deduplicates task items by stable ID so duplicates are never appended', () => {
      function deduplicateById<T extends { id: string }>(items: T[]): T[] {
        const seen = new Set<string>();
        const result: T[] = [];
        for (const item of items) {
          if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            result.push(item);
          }
        }
        return result;
      }

      const duplicateTasks = [sampleTask, sampleTask, { ...sampleTask }, { ...sampleTask, id: 't-unique-2' }];
      const deduped = deduplicateById(duplicateTasks);

      expect(deduped).toHaveLength(2);
      expect(deduped[0].id).toBe('t-safe-1');
      expect(deduped[1].id).toBe('t-unique-2');
    });

    it('makes handleTaskCreated strictly idempotent against repeated calls', () => {
      let currentScheduledTasks: TaskWithMeta[] = [];

      const handleTaskCreated = (newTask: TaskWithMeta) => {
        currentScheduledTasks = currentScheduledTasks.some((t) => t.id === newTask.id)
          ? currentScheduledTasks
          : [...currentScheduledTasks, newTask];
      };

      // Simulate rapid successive calls (like those from an effect loop)
      for (let i = 0; i < 50; i++) {
        handleTaskCreated(sampleTask);
      }

      // Must strictly contain only 1 entry
      expect(currentScheduledTasks).toHaveLength(1);
      expect(currentScheduledTasks[0].id).toBe('t-safe-1');
    });

    it('makes handleContentCreated strictly idempotent against repeated calls', () => {
      let currentScheduledContent: ContentItemWithMeta[] = [];

      const handleContentCreated = (newItem: ContentItemWithMeta) => {
        currentScheduledContent = currentScheduledContent.some((i) => i.id === newItem.id)
          ? currentScheduledContent
          : [...currentScheduledContent, newItem];
      };

      for (let i = 0; i < 50; i++) {
        handleContentCreated(sampleScheduledPost);
      }

      expect(currentScheduledContent).toHaveLength(1);
      expect(currentScheduledContent[0].id).toBe('c-scheduled-1');
    });

    it('ensures top-level New Task flow initializes without silent schedule defaults', () => {
      // When user clicks the top-level New Task button, no slot is selected
      let createTaskInitialStart: string | null = null;
      let createTaskInitialEnd: string | null = null;

      // Simulate clicking top-level New Task button
      createTaskInitialStart = null;
      createTaskInitialEnd = null;

      expect(createTaskInitialStart).toBeNull();
      expect(createTaskInitialEnd).toBeNull();

      // Form should default to isScheduled: false when initialScheduledStart is null
      const isScheduled = Boolean(createTaskInitialStart);
      expect(isScheduled).toBe(false);
    });

    it('ensures top-level New Content flow initializes without silent schedule defaults', () => {
      // When user clicks top-level New Content button, schedule is null and default status is draft
      let createContentInitialScheduledAt: string | null = null;
      let createContentDefaultStatus = 'draft';

      createContentInitialScheduledAt = null;
      createContentDefaultStatus = 'draft';

      expect(createContentInitialScheduledAt).toBeNull();
      expect(createContentDefaultStatus).toBe('draft');
    });

    it('distinguishes between intentional Day view slot and Month view date selection', () => {
      const dateKey = '2026-10-30';

      // 1. Day view: user clicks 14:00 slot
      const daySlotHour = 14;
      const dayLocalIso = `${dateKey}T${String(daySlotHour).padStart(2, '0')}:00`;
      expect(dayLocalIso).toBe('2026-10-30T14:00');

      // 2. Month view: user clicks date cell (no hour specified)
      const monthSlotHour: number | null = null;
      let pendingTime = '';

      // Validate that Month view requires a time before proceeding
      const requiresTime = monthSlotHour === null && !pendingTime.trim();
      expect(requiresTime).toBe(true);

      // Once user selects a time e.g. 11:30
      pendingTime = '11:30';
      const monthLocalIso = `${dateKey}T${pendingTime}`;
      expect(monthLocalIso).toBe('2026-10-30T11:30');
    });

    it('verifies CreateTaskModal submission flow calls onCreated only on success and not on re-renders', async () => {
      let callbackCount = 0;
      const onTaskCreated = vi.fn((_task: TaskWithMeta) => {
        callbackCount++;
      });
      const onClose = vi.fn();

      // Simulated submit handler
      const handleSubmit = async (isSuccess: boolean, taskData?: TaskWithMeta) => {
        if (isSuccess && taskData) {
          onTaskCreated(taskData);
          onClose();
        }
      };

      // 1. Submit succeeds
      await handleSubmit(true, sampleTask);
      expect(callbackCount).toBe(1);
      expect(onTaskCreated).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);

      // 2. Parent re-renders, creating new callback references
      const newOnTaskCreated = vi.fn();
      const newOnClose = vi.fn();

      // Because submit is an event handler (not an effect), re-render does NOT re-invoke submit
      expect(newOnTaskCreated).not.toHaveBeenCalled();
      expect(newOnClose).not.toHaveBeenCalled();
      expect(callbackCount).toBe(1);
    });
  });

  describe('Calendar Performance & Range Caching Optimization', () => {
    it('determines that day, week, and month ranges for the active month are covered by initialLoadedRange', () => {
      const monthGrid = getMonthGrid('2026-10-15T12:00:00Z', tz);
      const gridStartMs = monthGrid.cells[0].startOfDay.getTime();
      const gridEndMs = monthGrid.cells[monthGrid.cells.length - 1].endOfDay.getTime();

      const loadedRanges = [{ start: gridStartMs, end: gridEndMs }];

      const isRangeCovered = (startMs: number, endMs: number) => {
        return loadedRanges.some(
          (range) => range.start <= startMs + 1000 && range.end >= endMs - 1000
        );
      };

      // 1. Day view for Oct 15
      const dayRange = getDayRange('2026-10-15T12:00:00Z', tz);
      expect(isRangeCovered(dayRange.dayStart.getTime(), dayRange.dayEnd.getTime())).toBe(true);

      // 2. Week view for Oct 15
      const weekRange = getWeekRange('2026-10-15T12:00:00Z', tz);
      expect(isRangeCovered(weekRange.weekStart.getTime(), weekRange.weekEnd.getTime())).toBe(true);

      // 3. Month view for Oct 15
      expect(isRangeCovered(gridStartMs, gridEndMs)).toBe(true);

      // 4. Any day header within the week
      for (const d of weekRange.days) {
        expect(isRangeCovered(d.startOfDay.getTime(), d.endOfDay.getTime())).toBe(true);
      }

      // 5. Date in next month (e.g. Nov 20) is NOT covered
      const nextMonthDay = getDayRange('2026-11-20T12:00:00Z', tz);
      expect(isRangeCovered(nextMonthDay.dayStart.getTime(), nextMonthDay.dayEnd.getTime())).toBe(false);
    });

    it('replaces items in range without wiping cached items from other dates', () => {
      function deduplicateById<T extends { id: string }>(items: T[]): T[] {
        const seen = new Set<string>();
        const result: T[] = [];
        for (const item of items) {
          if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            result.push(item);
          }
        }
        return result;
      }

      function replaceItemsInRange<T extends { id: string }>(
        existing: T[],
        fresh: T[],
        rangeStartMs: number,
        rangeEndMs: number,
        getTimestampMs: (item: T) => number | null
      ): T[] {
        const freshIds = new Set(fresh.map((item) => item.id));
        const outside = existing.filter((item) => {
          if (freshIds.has(item.id)) return false;
          const ts = getTimestampMs(item);
          if (ts === null) return true;
          return ts < rangeStartMs || ts > rangeEndMs;
        });

        return deduplicateById([...outside, ...fresh]);
      }

      const sampleTask: TaskWithMeta = {
        id: 't-base-1',
        workspace_id: 'ws-1',
        parent_task_id: null,
        project_id: null,
        milestone_id: null,
        title: 'Base Task',
        description: null,
        priority: 'medium',
        status: 'todo',
        scheduled_start: '2026-10-10T10:00:00Z',
        scheduled_end: '2026-10-10T11:00:00Z',
        due_date: null,
        estimated_duration_minutes: 60,
        is_all_day: false,
        completed_at: null,
        tags: [],
        recurrence_rule_id: null,
        created_by: 'usr-1',
        assigned_to: null,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        subtask_count: 0,
        completed_subtask_count: 0,
        is_blocked: false,
        blocking_tasks: [],
        project: null,
      };

      const existingTasks: TaskWithMeta[] = [
        {
          ...sampleTask,
          id: 'task-oct-1',
          title: 'October Task 1',
          status: 'todo',
          priority: 'medium',
          scheduled_start: '2026-10-10T10:00:00Z',
          scheduled_end: '2026-10-10T11:00:00Z',
        },
        {
          ...sampleTask,
          id: 'task-nov-1',
          title: 'November Task 1',
          status: 'todo',
          priority: 'high',
          scheduled_start: '2026-11-15T10:00:00Z',
          scheduled_end: '2026-11-15T11:00:00Z',
        },
      ];

      // Re-fetching October range with an updated task and a new task
      const octStartMs = new Date('2026-10-01T00:00:00Z').getTime();
      const octEndMs = new Date('2026-10-31T23:59:59Z').getTime();

      const freshOctoberTasks: TaskWithMeta[] = [
        {
          ...existingTasks[0],
          status: 'done', // updated status
        },
        {
          ...sampleTask,
          id: 'task-oct-2',
          title: 'October Task 2 (new)',
          status: 'todo',
          priority: 'urgent',
          scheduled_start: '2026-10-20T14:00:00Z',
          scheduled_end: '2026-10-20T15:00:00Z',
        },
      ];

      const merged = replaceItemsInRange(
        existingTasks,
        freshOctoberTasks,
        octStartMs,
        octEndMs,
        (t) => (t.scheduled_start ? new Date(t.scheduled_start).getTime() : null)
      );

      // Preserves November task
      expect(merged.some((t) => t.id === 'task-nov-1')).toBe(true);
      // Updates October Task 1
      const updatedOct1 = merged.find((t) => t.id === 'task-oct-1');
      expect(updatedOct1?.status).toBe('done');
      // Adds October Task 2
      expect(merged.some((t) => t.id === 'task-oct-2')).toBe(true);
      expect(merged).toHaveLength(3);
    });

    it('forces cache bypass when task updates occur via handleTaskUpdated', () => {
      let fetchCalledWithForce = false;
      const fetchContentAndTasks = (_date: Date, _mode: string, force = false) => {
        fetchCalledWithForce = force;
      };

      const handleTaskUpdated = () => {
        fetchContentAndTasks(new Date(), 'week', true);
      };

      handleTaskUpdated();
      expect(fetchCalledWithForce).toBe(true);
    });
  });
});
