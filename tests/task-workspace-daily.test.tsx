import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskWorkspace } from '../src/components/tasks/TaskWorkspace';
import type { TaskWithMeta } from '../src/lib/services/task-service';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/tasks',
}));

vi.mock('@/lib/actions/task-actions', () => ({
  completeTaskAction: vi.fn(),
  getTaskDetailAction: vi.fn(async () => ({ success: false })),
  createTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
  deleteTaskAction: vi.fn(),
}));

const makeTask = (overrides: Partial<TaskWithMeta> = {}): TaskWithMeta =>
  ({
    id: 't1',
    workspace_id: 'w1',
    title: 'Sample Task',
    description: null,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    scheduled_start: null,
    scheduled_end: null,
    entry_type: 'task',
    created_from: 'tasks',
    project_id: null,
    parent_task_id: null,
    milestone_id: null,
    recurrence_rule_id: null,
    occurrence_index: null,
    created_by: null,
    assigned_to: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    subtask_count: 0,
    completed_subtask_count: 0,
    is_blocked: false,
    blocking_tasks: [],
    project: null,
    ...overrides,
  }) as TaskWithMeta;

describe('TaskWorkspace Today default & chronological order', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sampleTasks: TaskWithMeta[] = [
    makeTask({
      id: 'late-today',
      title: 'Late Today Task',
      scheduled_start: '2026-11-05T17:00:00Z',
    }),
    makeTask({
      id: 'early-today',
      title: 'Early Today Task',
      scheduled_start: '2026-11-05T07:30:00Z',
    }),
    makeTask({
      id: 'tomorrow-task',
      title: 'Tomorrow Task',
      due_date: '2026-11-06T09:00:00Z',
    }),
    makeTask({
      id: 'undated-task',
      title: 'Undated Task',
    }),
  ];

  it('defaults to Today and renders today tasks in chronological order (earliest first)', () => {
    const html = renderToStaticMarkup(
      React.createElement(TaskWorkspace, {
        initialTasks: sampleTasks,
        workspaceId: 'w1',
        projects: [],
        userTimeZone: 'Africa/Cairo',
      })
    );

    expect(html).toContain('Time: earliest first');
    expect(html).toContain('aria-label="Previous day"');
    expect(html).toContain('aria-label="Next day"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Today</);
    expect(html).toContain('Early Today Task');
    expect(html).toContain('Late Today Task');
    expect(html).not.toContain('Tomorrow Task');
    expect(html).not.toContain('Undated Task');
    expect(html.indexOf('Early Today Task')).toBeLessThan(html.indexOf('Late Today Task'));
  });

  it('defaults to All when initialTaskId is provided and respects explicit initialDateFilter', () => {
    const deepLinkedHtml = renderToStaticMarkup(
      React.createElement(TaskWorkspace, {
        initialTasks: sampleTasks,
        workspaceId: 'w1',
        projects: [],
        userTimeZone: 'Africa/Cairo',
        initialTaskId: 'tomorrow-task',
      })
    );

    expect(deepLinkedHtml).toMatch(/aria-pressed="true"[^>]*>Any date</);
    expect(deepLinkedHtml).toContain('Tomorrow Task');
    expect(deepLinkedHtml).toContain('Undated Task');
    expect(deepLinkedHtml.indexOf('Early Today Task')).toBeLessThan(
      deepLinkedHtml.indexOf('Tomorrow Task')
    );

    const explicitFilterHtml = renderToStaticMarkup(
      React.createElement(TaskWorkspace, {
        initialTasks: sampleTasks,
        workspaceId: 'w1',
        projects: [],
        userTimeZone: 'Africa/Cairo',
        initialDateFilter: 'unscheduled',
      })
    );

    expect(explicitFilterHtml).toMatch(/aria-pressed="true"[^>]*>No date</);
    expect(explicitFilterHtml).toContain('Undated Task');
    expect(explicitFilterHtml).not.toContain('Early Today Task');
  });
});
