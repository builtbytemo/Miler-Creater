import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DashboardActionNeeded,
  formatRelativeUrgency,
  computeQuickRescheduleIso,
} from '../src/components/dashboard/DashboardActionNeeded';
import { DashboardContentPipeline } from '../src/components/dashboard/DashboardContentPipeline';
import { DashboardKpiCard } from '../src/components/dashboard/DashboardKpiCard';
import { DashboardRecentNotifications } from '../src/components/dashboard/DashboardRecentNotifications';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/actions/task-actions', () => ({
  completeTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
}));

describe('Dashboard UX Overhaul: Information -> Action', () => {
  const refIso = '2026-11-13T12:00:00.000Z';

  it('computes accurate relative urgency labels across overdue, soon, and empty due dates', () => {
    expect(formatRelativeUrgency('2026-11-13T11:45:00.000Z', refIso, 'UTC')).toEqual({
      label: '15m overdue',
      tone: 'overdue',
    });
    expect(formatRelativeUrgency('2026-11-13T08:00:00.000Z', refIso, 'UTC')).toEqual({
      label: '4h overdue',
      tone: 'overdue',
    });
    expect(formatRelativeUrgency('2026-11-11T12:00:00.000Z', refIso, 'UTC')).toEqual({
      label: '2d overdue',
      tone: 'overdue',
    });
    expect(formatRelativeUrgency('2026-11-13T14:30:00.000Z', refIso, 'UTC')).toEqual({
      label: 'In 3h',
      tone: 'soon',
    });
    expect(formatRelativeUrgency(null, refIso, 'UTC')).toEqual({
      label: 'No due date',
      tone: 'normal',
    });
  });

  it('computes future reschedule timestamps cleanly even for deeply overdue items', () => {
    const tomorrowIso = computeQuickRescheduleIso('2026-11-01T15:30:00.000Z', refIso, 1);
    expect(tomorrowIso).toBe('2026-11-14T15:30:00.000Z');
    expect(new Date(tomorrowIso).getTime()).toBeGreaterThan(new Date(refIso).getTime());

    const fallbackHourIso = computeQuickRescheduleIso(null, refIso, 3);
    expect(fallbackHourIso).toBe('2026-11-16T14:00:00.000Z');
  });

  it('renders separated Priority Tasks & Publishing Within 24h with direct deep links and inline task controls', () => {
    const html = renderToStaticMarkup(
      <DashboardActionNeeded
        workspaceId="ws-live-1"
        referenceTimeIso={refIso}
        timeZone="UTC"
        urgentTasks={[
          {
            id: 'task-overdue-1',
            title: 'Unblock production webhook deploy',
            priority: 'urgent',
            status: 'todo',
            due_date: '2026-11-12T12:00:00.000Z',
            project_id: 'proj-1',
          },
        ]}
        upcomingContent={[
          {
            id: 'content-24h-1',
            title: 'Zahi Release Notes Thread',
            platform: 'x',
            status: 'scheduled',
            scheduled_at: '2026-11-13T16:00:00.000Z',
            action_type: 'post',
          },
        ]}
      />
    );

    expect(html).toContain('Priority tasks');
    expect(html).toContain('Publishing within 24 hours');
    expect(html).toContain('1d overdue');
    expect(html).toContain('urgent priority');
    expect(html).toContain('href="/tasks?taskId=task-overdue-1"');
    expect(html).toContain('Complete &quot;Unblock production webhook deploy&quot;');
    expect(html).toContain('Reschedule &quot;Unblock production webhook deploy&quot;');
    expect(html).toContain('href="/content?tab=scheduled&amp;contentId=content-24h-1"');
  });

  it('safely suppresses mutation controls on non-persistent local-preview workspaces', () => {
    const html = renderToStaticMarkup(
      <DashboardActionNeeded
        workspaceId="local-preview"
        referenceTimeIso={refIso}
        timeZone="UTC"
        urgentTasks={[
          {
            id: 'preview-task-1',
            title: 'Preview read-only task',
            priority: 'high',
            status: 'todo',
            due_date: '2026-11-13T15:00:00.000Z',
            project_id: null,
          },
        ]}
        upcomingContent={[]}
      />
    );

    expect(html).toContain('Preview read-only task');
    expect(html).not.toContain('Complete &quot;Preview read-only task&quot;');
    expect(html).not.toContain('Reschedule &quot;Preview read-only task&quot;');
  });

  it('wires Content Pipeline metrics, platform filters, and posts to exact filtered /content URLs', () => {
    const html = renderToStaticMarkup(
      <DashboardContentPipeline
        timeZone="UTC"
        content={{
          draftCount: 4,
          ideaCount: 9,
          scheduledNext24HoursCount: 2,
          scheduledNext7DaysCount: 6,
          byPlatform: {
            linkedin: 3,
            reddit: 1,
            threads: 0,
            x: 2,
          },
          upcomingItems: [
            {
              id: 'content-99',
              title: 'Launch case study breakdown',
              platform: 'linkedin',
              status: 'scheduled',
              scheduled_at: '2026-11-14T10:00:00.000Z',
              action_type: 'post',
            },
          ],
        }}
      />
    );

    expect(html).toContain('href="/content?tab=drafts"');
    expect(html).toContain('href="/content?tab=ideas"');
    expect(html).toContain('href="/content?tab=scheduled"');
    expect(html).toContain('href="/content?tab=scheduled&amp;platform=linkedin"');
    expect(html).toContain('href="/content?tab=scheduled&amp;platform=x"');
    expect(html).toContain('href="/content?tab=scheduled&amp;contentId=content-99"');
  });

  it('renders KPI hero tier highlight bar & unread alert filter links', () => {
    const heroHtml = renderToStaticMarkup(
      <DashboardKpiCard
        title="Overdue Tasks"
        count={3}
        href="/tasks?dateFilter=overdue"
        variant="danger"
        tier="hero"
        subtitle="Filter overdue"
      />
    );

    expect(heroHtml).toContain('href="/tasks?dateFilter=overdue"');
    expect(heroHtml).toContain('Filter overdue');
    expect(heroHtml).toContain('h-[2px]');

    const notifHtml = renderToStaticMarkup(
      <DashboardRecentNotifications
        timeZone="UTC"
        notifications={{
          unreadCount: 2,
          recentUnread: [
            {
              id: 'n-1',
              workspace_id: 'ws-1',
              recipient_id: 'usr-1',
              channel: 'in_app',
              status: 'delivered',
              scheduled_for: '2026-11-13T11:30:00.000Z',
              delivered_at: '2026-11-13T11:30:00.000Z',
              title: 'Task blocked',
              message: 'Waiting on dependency signoff',
              entity_type: 'task',
              entity_id: 'task-9',
              read_at: null,
              created_at: '2026-11-13T11:30:00.000Z',
              idempotency_key: 'k-1',
            },
          ],
        }}
      />
    );

    expect(notifHtml).toContain('href="/notifications?filter=unread"');
    expect(notifHtml).toContain('href="/notifications"');
  });
});
