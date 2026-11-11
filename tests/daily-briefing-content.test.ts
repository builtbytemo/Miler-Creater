/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSnapshotForUser, createDailyBriefingGenerator } from '../src/lib/briefing/daily/generator';
import { renderEmail } from '../src/lib/briefing/daily/render-email';
import { renderTelegram, TELEGRAM_MESSAGE_LIMIT } from '../src/lib/briefing/daily/render-telegram';
import { buildBriefingSnapshot } from '../src/lib/briefing/daily/build';
import { taskWindowFilter } from '../src/lib/briefing/daily/source';
import { dispatchDueBriefings } from '../src/lib/briefing/dispatcher';
import { createTelegramAdapter } from '../src/lib/briefing/channels/telegram';
import { createFakeAdmin } from './helpers-briefing-fake-db';
import { DATE, cairo, content, makeAdmin, task } from './helpers-briefing-content';

const snap = async (w: Parameters<typeof makeAdmin>[0], date = DATE) => buildSnapshotForUser(makeAdmin(w).admin, 'u1', date);
const titles = (xs: Array<{ title: string }>) => xs.map((x) => x.title);

describe('Tasks: eligibility and date matching', () => {
  it('includes a task on its scheduled date and on its deadline date', async () => {
    const s = await snap({
      tasks: [
        task({ title: 'Sched', scheduled_start: cairo('09:00') }),
        task({ title: 'Due', due_date: cairo('18:00') }),
        task({ title: 'Other day', scheduled_start: cairo('09:00', '2026-11-12'), due_date: cairo('09:00', '2026-11-13') }),
      ],
    });
    expect(titles(s.tasks)).toEqual(['Sched', 'Due']);
  });

  it('lists a task once when scheduled AND due dates both match, showing both times', async () => {
    const s = await snap({ tasks: [task({ title: 'Both', scheduled_start: cairo('09:00'), due_date: cairo('23:59') })] });
    expect(s.tasks).toHaveLength(1);
    expect(renderEmail(s).text).toContain('Both | Scheduled 9:00 AM · Due 11:59 PM');
  });

  it('shows the other date when only one of the two dates falls on the briefing day', async () => {
    const s = await snap({ tasks: [task({ title: 'Later due', scheduled_start: cairo('09:00'), due_date: cairo('18:00', '2026-11-13') })] });
    expect(renderEmail(s).text).toContain('Later due | Scheduled 9:00 AM · Due Fri, Nov 13, 6:00 PM');
  });

  it('shows date-assigned all-day items as Anytime, after timed items', async () => {
    const s = await snap({
      tasks: [
        task({ title: 'A read', is_all_day: true, due_date: cairo('00:00') }),
        task({ title: 'Timed late', scheduled_start: cairo('20:00') }),
        task({ title: 'Timed early', scheduled_start: cairo('08:00') }),
      ],
    });
    expect(titles(s.tasks)).toEqual(['Timed early', 'Timed late', 'A read']);
    expect(renderEmail(s).text).toContain('A read | Anytime');
  });

  it('excludes undated tasks, however unfinished', async () => {
    const s = await snap({ tasks: [task({ title: 'No date' }), task({ title: 'Blocked, no date', status: 'blocked' })] });
    expect(s.tasks).toEqual([]);
  });

  it('excludes done and cancelled tasks, keeps in_progress and blocked', async () => {
    const d = cairo('10:00');
    const s = await snap({
      tasks: [
        task({ title: 'done', status: 'done', scheduled_start: d }),
        task({ title: 'cancelled', status: 'cancelled', scheduled_start: d }),
        task({ title: 'wip', status: 'in_progress', scheduled_start: d }),
        task({ title: 'blocked', status: 'blocked', scheduled_start: d }),
      ],
    });
    expect(titles(s.tasks).sort()).toEqual(['blocked', 'wip']);
  });

  it('orders timed items chronologically (earliest relevant time that day), ties by title', async () => {
    const s = await snap({
      tasks: [
        task({ title: 'C', scheduled_start: cairo('15:00') }),
        task({ title: 'B', due_date: cairo('09:00') }),
        task({ title: 'A', scheduled_start: cairo('09:00') }),
        task({ title: 'D', scheduled_start: cairo('07:30'), due_date: cairo('23:00') }),
      ],
    });
    expect(titles(s.tasks)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('never exposes ids and de-duplicates repeated rows of the same record', async () => {
    const t = task({ title: 'Dup', scheduled_start: cairo('09:00') });
    const s = await snap({ tasks: [t, { ...t }] });
    expect(s.tasks).toHaveLength(1);
    expect(renderTelegram(s).text).not.toContain(t.id);
  });
});

describe('Content eligibility', () => {
  it('includes actionable content on its publish date; excludes published/archived/unscheduled/other days', async () => {
    const at = cairo('15:00');
    const s = await snap({
      content: [
        content({ title: 'Idea', status: 'idea', scheduled_at: at }),
        content({ title: 'Draft', status: 'draft', scheduled_at: cairo('10:00') }),
        content({ title: 'Failed', status: 'failed', scheduled_at: cairo('11:00') }),
        content({ title: 'Published', status: 'published', scheduled_at: at }),
        content({ title: 'Archived', status: 'archived', scheduled_at: at }),
        content({ title: 'Unscheduled', status: 'idea', scheduled_at: null }),
        content({ title: 'Tomorrow', scheduled_at: cairo('15:00', '2026-11-12') }),
      ],
    });
    expect(titles(s.content)).toEqual(['Draft', 'Failed', 'Idea']);
  });

  it('renders the publish time with a label', async () => {
    const s = await snap({ content: [content({ title: 'Product announcement', scheduled_at: cairo('15:00') })] });
    expect(renderEmail(s).text).toContain('Product announcement | Publish 3:00 PM');
  });
});

describe('Workspaces and authorization', () => {
  const two = {
    members: [{ workspace_id: 'w1', user_id: 'u1' }, { workspace_id: 'w2', user_id: 'u1', role: 'viewer' }],
    workspaces: [{ id: 'w1', name: 'Acme' }, { id: 'w2', name: 'Side Gig' }],
  };

  it('aggregates every accessible workspace (any role, regardless of assignee/creator)', async () => {
    const s = await snap({
      ...two,
      profiles: [{ id: 'other', full_name: 'Sam Teammate' }],
      tasks: [
        task({ title: 'W1 task', workspace_id: 'w1', scheduled_start: cairo('09:00') }),
        task({ title: 'W2 for Sam', workspace_id: 'w2', assigned_to: 'other', scheduled_start: cairo('10:00') }),
      ],
      content: [content({ title: 'W2 post', workspace_id: 'w2', scheduled_at: cairo('11:00') })],
    });
    expect(titles(s.tasks)).toEqual(['W1 task', 'W2 for Sam']);
    expect(s.tasks[1].assignedTo).toBe('Sam Teammate');
    expect(titles(s.content)).toEqual(['W2 post']);
    expect(s.workspaceCount).toBe(2);
  });

  it('never returns records from workspaces the user is not a member of', async () => {
    const s = await snap({
      workspaces: [{ id: 'w1', name: 'Acme' }, { id: 'secret', name: 'Not Mine' }],
      tasks: [task({ title: 'Mine', scheduled_start: cairo('09:00') }), task({ title: 'Foreign', workspace_id: 'secret', scheduled_start: cairo('09:00') })],
      content: [content({ title: 'Foreign post', workspace_id: 'secret', scheduled_at: cairo('09:00') })],
    });
    expect(titles(s.tasks)).toEqual(['Mine']);
    expect(s.content).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('Not Mine');
  });

  it('respects membership changes at generation time (removed member sees nothing)', async () => {
    const w = { tasks: [task({ title: 'T', scheduled_start: cairo('09:00') })] };
    const { admin, db } = makeAdmin(w);
    expect((await buildSnapshotForUser(admin, 'u1', DATE)).tasks).toHaveLength(1);
    db.tables.workspace_members.length = 0;
    const after = await buildSnapshotForUser(admin, 'u1', DATE);
    expect(after.tasks).toEqual([]);
    expect(after.workspaceCount).toBe(0);
  });

  it('defense in depth: a leaky data source cannot surface foreign records', () => {
    const leaky: any = {
      timezone: 'Africa/Cairo',
      workspaces: { w1: 'Acme' },
      tasks: [task({ title: 'Foreign', workspace_id: 'zzz', scheduled_start: cairo('09:00') })],
      content: [content({ title: 'Foreign', workspace_id: 'zzz', scheduled_at: cairo('09:00') })],
      projects: {}, milestones: {}, profiles: {}, socialAccounts: {}, parentTitles: {},
    };
    const s = buildBriefingSnapshot(leaky, DATE);
    expect(s.tasks).toEqual([]);
    expect(s.content).toEqual([]);
  });

  it('retrieval is scoped by the authorized workspace ids', async () => {
    const { admin } = makeAdmin({ tasks: [task({ workspace_id: 'w1', scheduled_start: cairo('09:00') })] });
    const spy = vi.spyOn(admin, 'from');
    await buildSnapshotForUser(admin, 'u1', DATE);
    expect(spy).toHaveBeenCalledWith('workspace_members');
    expect(taskWindowFilter('A', 'B')).toContain('scheduled_start.gte.A');
  });

  it('paginates tasks and content when records exceed 1000, never silently dropping rows', async () => {
    const manyTasks = Array.from({ length: 1050 }, (_, i) =>
      task({ title: `Task ${i}`, scheduled_start: cairo('09:00') })
    );
    const { admin } = makeAdmin({ tasks: manyTasks });
    const s = await buildSnapshotForUser(admin, 'u1', DATE);
    expect(s.tasks).toHaveLength(1050);
  });

  it('fails closed and throws an error if a query fails, preventing a false empty day', async () => {
    const { admin } = makeAdmin();
    vi.spyOn(admin, 'from').mockImplementation(((table: string) => {
      if (table === 'tasks') {
        const b: any = {
          select: () => b,
          in: () => b,
          neq: () => b,
          or: () => b,
          range: () => Promise.resolve({ data: null, error: { message: 'Database connection dropped' } }),
        };
        return b;
      }
      return (makeAdmin().admin as any).from(table);
    }) as any);

    await expect(buildSnapshotForUser(admin, 'u1', DATE)).rejects.toThrow('briefing_source_tasks_failed');
  });
});

describe('Recurrence', () => {
  it('lists the real occurrence once; a series is not due every day', async () => {
    const s1 = await snap({ tasks: [task({ title: 'Standup', recurrence_rule_id: 'r1', occurrence_index: 4, scheduled_start: cairo('09:00') })] });
    expect(titles(s1.tasks)).toEqual(['Standup']);
    const s2 = await snap({ tasks: [task({ title: 'Standup', recurrence_rule_id: 'r1', occurrence_index: 4, scheduled_start: cairo('09:00') })] }, '2026-11-12');
    expect(s2.tasks).toEqual([]);
  });

  it('collapses duplicate rows of the same occurrence and excludes completed occurrences', async () => {
    const s = await snap({
      tasks: [
        task({ title: 'Standup', recurrence_rule_id: 'r1', occurrence_index: 4, scheduled_start: cairo('09:00') }),
        task({ title: 'Standup', recurrence_rule_id: 'r1', occurrence_index: 4, scheduled_start: cairo('09:00') }),
        task({ title: 'Standup', recurrence_rule_id: 'r1', occurrence_index: 3, status: 'done', scheduled_start: cairo('08:00') }),
      ],
    });
    expect(s.tasks).toHaveLength(1);
  });
});

describe('Day Finder (calendar blocks)', () => {
  it('lists calendar-origin blocks ordered by start with name, start and end; tasks stay out of Day Finder', async () => {
    const s = await snap({
      tasks: [
        task({ title: 'Lunch', created_from: 'calendar', scheduled_start: cairo('13:00'), scheduled_end: cairo('14:00') }),
        task({ title: 'University', created_from: 'calendar', scheduled_start: cairo('09:00'), scheduled_end: cairo('12:00') }),
        task({ title: 'Plain task', scheduled_start: cairo('09:00') }),
      ],
    });
    expect(s.dayFinder.map((b) => b.name)).toEqual(['University', 'Lunch']);
    expect(titles(s.tasks)).toEqual(['Plain task']);
    expect(renderEmail(s).text).toContain('University | 9:00 AM–12:00 PM');
  });

  it('includes calendar-origin content in Content so it is never lost from briefings or Telegram', async () => {
    const s = await snap({ content: [content({ title: 'Live stream', created_from: 'calendar', scheduled_at: cairo('18:00'), duration_minutes: 90 })] });
    expect(titles(s.content)).toEqual(['Live stream']);
    expect(renderEmail(s).text).toContain('Live stream | Publish 6:00 PM');
    expect(renderTelegram(s).text).toContain('Live stream');
  });

  it('includes tasks created through the calendar that have a deadline (due_date) in Tasks', async () => {
    const s = await snap({
      tasks: [
        task({ title: 'Calendar task with due date', created_from: 'calendar', scheduled_start: cairo('10:00'), due_date: cairo('17:00') }),
        task({ title: 'Calendar appointment block', created_from: 'calendar', scheduled_start: cairo('10:00'), due_date: null }),
      ],
    });
    expect(titles(s.tasks)).toEqual(['Calendar task with due date']);
    expect(s.dayFinder.map((b) => b.name)).toEqual(['Calendar appointment block']);
    expect(renderTelegram(s).text).toContain('Calendar task with due date');
    expect(renderTelegram(s).text).not.toContain('Calendar appointment block');
  });

  it('handles cross-midnight blocks on both days and excludes blocks ending exactly at midnight', async () => {
    const night = task({ title: 'Night shift', created_from: 'calendar', scheduled_start: cairo('22:00', '2026-11-10'), scheduled_end: cairo('02:00') });
    const late = task({ title: 'Late', created_from: 'calendar', scheduled_start: cairo('22:00'), scheduled_end: cairo('02:00', '2026-11-12') });
    const ends = task({ title: 'Ends at midnight', created_from: 'calendar', scheduled_start: cairo('22:00', '2026-11-10'), scheduled_end: cairo('00:00') });
    const s = await snap({ tasks: [night, late, ends] });
    expect(s.dayFinder.map((b) => b.name)).toEqual(['Night shift', 'Late']);
    const text = renderEmail(s).text;
    expect(text).toContain('Night shift | Tue, Nov 10, 10:00 PM–2:00 AM');
    expect(text).toContain('Late | 10:00 PM–Thu, Nov 12, 2:00 AM');
  });

  it('excludes cancelled blocks, other days; shows all-day blocks as "All day" first', async () => {
    const s = await snap({
      tasks: [
        task({ title: 'Cancelled', status: 'cancelled', created_from: 'calendar', scheduled_start: cairo('09:00') }),
        task({ title: 'Tomorrow', created_from: 'calendar', scheduled_start: cairo('09:00', '2026-11-12') }),
        task({ title: 'Conference', created_from: 'calendar', is_all_day: true, scheduled_start: cairo('00:00') }),
        task({ title: 'Call', created_from: 'calendar', scheduled_start: cairo('08:00'), scheduled_end: cairo('08:30') }),
      ],
    });
    expect(s.dayFinder.map((b) => b.name)).toEqual(['Conference', 'Call']);
    expect(renderEmail(s).text).toContain('Conference | All day');
  });
});

describe('Timezones and DST', () => {
  it('uses the user timezone to pick the local day', async () => {
    const instant = '2026-11-11T22:30:00Z'; // Nov 11 in New York, already Nov 12 in Cairo
    const w = { tasks: [task({ title: 'Edge', scheduled_start: instant })] };
    expect((await snap({ ...w, timezone: 'America/New_York' }, '2026-11-11')).tasks).toHaveLength(1);
    expect((await snap({ ...w, timezone: 'Africa/Cairo' }, '2026-11-11')).tasks).toHaveLength(0);
    expect((await snap({ ...w, timezone: 'Africa/Cairo' }, '2026-11-12')).tasks).toHaveLength(1);
  });

  it('handles the spring-forward day (23h) and fall-back day (25h) boundaries', async () => {
    const ny = 'America/New_York';
    const spring = [
      task({ title: 'Prev 11:59 PM EST', due_date: '2026-03-08T04:59:00Z' }),
      task({ title: 'Midnight EST', due_date: '2026-03-08T05:00:00Z' }),
      task({ title: '10 AM EDT', scheduled_start: '2026-03-08T14:00:00Z' }),
      task({ title: 'End of day EDT', due_date: '2026-03-09T03:59:00Z' }),
      task({ title: 'Next midnight EDT', due_date: '2026-03-09T04:00:00Z' }),
    ];
    const s = await snap({ tasks: spring, timezone: ny }, '2026-03-08');
    expect(titles(s.tasks)).toEqual(['Midnight EST', '10 AM EDT', 'End of day EDT']);
    expect(renderEmail(s).text).toContain('10 AM EDT | Scheduled 10:00 AM');

    const fall = [
      task({ title: 'First 1 AM EDT', scheduled_start: '2026-11-01T05:30:00Z' }),
      task({ title: 'Second 1 AM EST', scheduled_start: '2026-11-01T06:30:00Z' }),
      task({ title: 'Next day', scheduled_start: '2026-11-02T05:00:00Z' }),
    ];
    const f = await snap({ tasks: fall, timezone: ny }, '2026-11-01');
    expect(titles(f.tasks)).toEqual(['First 1 AM EDT', 'Second 1 AM EST']);
  });

  it('formats times in the receiving user timezone', async () => {
    const s = await snap({ tasks: [task({ title: 'T', scheduled_start: '2026-11-11T14:00:00Z' })], timezone: 'America/New_York' });
    expect(renderEmail(s).text).toContain('T | Scheduled 9:00 AM');
  });
});

describe('Empty states', () => {
  it('hides empty sections', async () => {
    const s = await snap({ tasks: [task({ title: 'Only task', scheduled_start: cairo('09:00') })] });
    const e = renderEmail(s);
    expect(e.html).toContain('>Tasks<');
    expect(e.html).not.toContain('>Content<');
    expect(e.html).not.toContain('>Day Finder<');
    const t = renderTelegram(s).text;
    expect(t).toContain('Tasks');
    expect(t).not.toContain('Content');
  });

  it('delivers a friendly empty-day message in both channels', async () => {
    const s = await snap({});
    expect(renderEmail(s).text).toContain('Nothing is scheduled for today');
    expect(renderEmail(s).html).toContain('Wednesday');
    expect(renderEmail(s).html).toContain('November 11, 2026');
    const t = renderTelegram(s);
    expect(t.parts).toHaveLength(1);
    expect(t.text).toContain('Nothing on your list for today');
  });

  it('Telegram is empty (and still delivered) when only Day Finder blocks exist; email shows the block', async () => {
    const s = await snap({ tasks: [task({ title: 'Gym', created_from: 'calendar', scheduled_start: cairo('07:00'), scheduled_end: cairo('08:00') })] });
    expect(renderTelegram(s).text).toContain('Nothing on your list for today');
    expect(renderEmail(s).text).toContain('Gym | 7:00 AM–8:00 AM');
  });
});

describe('Email rendering', () => {
  const rich = () =>
    snap({
      projects: [{ id: 'p1', name: 'Launch' }],
      profiles: [{ id: 'a1', full_name: 'Ada' }],
      tasks: [task({ title: 'Ship', description: 'SECRET-DESCRIPTION', priority: 'urgent', project_id: 'p1', assigned_to: 'a1', scheduled_start: cairo('09:00') })],
      content: [content({ title: 'Announce', body: 'SECRET-BODY', scheduled_at: cairo('15:00') })],
    });

  it('is minimal: no descriptions, priorities, assignees or projects', async () => {
    const { text, html } = renderEmail(await rich());
    for (const leak of ['SECRET-DESCRIPTION', 'SECRET-BODY', 'urgent', 'Urgent', 'Ada', 'Launch']) {
      expect(text).not.toContain(leak);
      expect(html).not.toContain(leak);
    }
  });

  it('orders sections Tasks, Content, Day Finder and uses the real date', async () => {
    const s = await snap({
      tasks: [task({ title: 'T', scheduled_start: cairo('09:00') }), task({ title: 'Block', created_from: 'calendar', scheduled_start: cairo('10:00'), scheduled_end: cairo('11:00') })],
      content: [content({ title: 'C', scheduled_at: cairo('12:00') })],
    });
    const { text, subject, html } = renderEmail(s);
    expect(text.indexOf('TASKS')).toBeLessThan(text.indexOf('CONTENT'));
    expect(text.indexOf('CONTENT')).toBeLessThan(text.indexOf('DAY FINDER'));
    expect(subject).toContain('Wed, Nov 11');
    expect(html).toContain('Wednesday');
    expect(html).toContain('November 11, 2026');
    expect(html).toContain('viewport');
  });

  it('renders the approved Architectural Atelier Planner email presentation', async () => {
    const s = await rich();
    const email = renderEmail(s);
    expect(email.html).toContain('01 / </span>Tasks');
    expect(email.html).toContain('02 / </span>Content');
    expect(email.html).toContain('Wednesday');
    expect(email.html).toContain('November 11, 2026');
    expect(email.html).toContain('Miler Daily Planner');
  });

  it('escapes user-generated HTML everywhere', async () => {
    const evil = '<script>alert("x")</script> & "Co"';
    const s = await snap({
      tasks: [task({ title: evil, scheduled_start: cairo('09:00') })],
      content: [content({ title: `<img src=x onerror=1>`, scheduled_at: cairo('10:00') })],
      workspaces: [{ id: 'w1', name: '<b>ws</b>' }],
    });
    const { html } = renderEmail(s);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Co&quot;');
  });
});

describe('Telegram rendering', () => {
  it('includes all available useful details and omits empty fields and internal ids', async () => {
    const t = task({
      title: 'Programming assignment', description: 'Implement the parser.\nAdd tests.', priority: 'high', status: 'in_progress',
      project_id: 'p1', milestone_id: 'm1', assigned_to: 'a1', estimated_duration_minutes: 90, tags: ['school', 'cs'],
      scheduled_start: cairo('09:00'), scheduled_end: cairo('10:30'), due_date: cairo('23:59'),
    });
    const c = content({
      title: 'Product announcement', body: 'We are live!', notes: 'Tag the team', platform: 'x', action_type: 'post', status: 'draft',
      social_account_id: 's1', duration_minutes: 15, tags: ['launch'], project_id: 'p1', scheduled_at: cairo('15:00'),
      external_links: ['https://example.com/a', { url: 'https://example.com/b', title: 'Press kit' }], media_urls: [{ url: 'https://cdn.example.com/i.png', alt: 'Hero' }],
      target_reference: { url: 'https://x.com/post/1' },
    });
    const s = await snap({
      projects: [{ id: 'p1', workspace_id: 'w1', name: 'Launch' }], milestones: [{ id: 'm1', workspace_id: 'w1', title: 'Beta' }], profiles: [{ id: 'a1', full_name: 'Ada' }],
      social_accounts: [{ id: 's1', workspace_id: 'w1', account_handle: '@miler', account_name: null }], tasks: [t], content: [c],
    });
    const { text, parts } = renderTelegram(s);
    for (const expected of [
      'Programming assignment', 'Scheduled 9:00 AM–10:30 AM · Due 11:59 PM', 'High priority', 'In progress', 'Launch', 'Beta',
      'Assigned to Ada', 'Estimated 90 min', 'Implement the parser.\nAdd tests.', 'school, cs',
      'Product announcement', 'Publish 3:00 PM', 'X post', '@miler', 'Draft', 'We are live!', 'Tag the team', 'https://example.com/a',
      'Press kit', 'https://example.com/b', 'Hero', 'https://x.com/post/1', 'launch',
    ]) expect(text).toContain(expected);
    expect(text.indexOf('Tasks')).toBeLessThan(text.indexOf('Content'));
    expect(text).not.toContain('Day Finder');
    expect(text).not.toContain(t.id);
    expect(text).not.toContain(c.id);
    expect(parts[0]).toContain('<a href="https://example.com/b">Press kit</a>');
    expect(text).not.toMatch(/undefined|null/);
  });

  it('omits fields without meaningful data and hides the workspace for single-workspace users', async () => {
    const s = await snap({ tasks: [task({ title: 'Bare', scheduled_start: cairo('09:00') })] });
    const t = renderTelegram(s).text;
    expect(t).not.toMatch(/Assigned|Estimated|🏢|📁|🏷|📝/);
  });

  it('shows the workspace when the user belongs to several', async () => {
    const s = await snap({
      members: [{ workspace_id: 'w1', user_id: 'u1' }, { workspace_id: 'w2', user_id: 'u1' }],
      workspaces: [{ id: 'w1', name: 'Acme' }, { id: 'w2', name: 'Side Gig' }],
      tasks: [task({ title: 'X', workspace_id: 'w2', scheduled_start: cairo('09:00') })],
    });
    expect(renderTelegram(s).text).toContain('Side Gig');
  });

  it('escapes HTML-special characters and attribute quotes', async () => {
    const s = await snap({
      tasks: [task({ title: 'a <b> & c', description: '1 < 2 && "x" > 0', scheduled_start: cairo('09:00') })],
      content: [content({ title: 't', scheduled_at: cairo('10:00'), external_links: [{ url: 'https://e.com/?a=1&b="2"', title: '<x>' }] })],
    });
    const { parts } = renderTelegram(s);
    const html = parts.join('');
    expect(html).toContain('• <b>a &lt;b&gt; &amp; c</b>');
    expect(html).toContain('1 &lt; 2 &amp;&amp; &quot;x&quot; &gt; 0');
    expect(html).toContain('<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">&lt;x&gt;</a>');
  });

  it('ignores non-http(s) links', async () => {
    const s = await snap({ content: [content({ scheduled_at: cairo('10:00'), external_links: ['javascript:alert(1)', 'https://ok.example'] })] });
    const t = renderTelegram(s).text;
    expect(t).not.toContain('javascript:');
    expect(t).toContain('https://ok.example');
  });

  it('splits long briefings into ordered messages under the limit without losing any detail', async () => {
    const words = Array.from({ length: 4000 }, (_, i) => `w${i + 1}`).join(' ');
    const items = Array.from({ length: 30 }, (_, i) => task({ title: `Item ${i + 1}`, description: i === 0 ? words : `desc-${i + 1} & <ok>`, scheduled_start: cairo('09:00') }));
    const s = await snap({ tasks: items });
    const { parts, text } = renderTelegram(s);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(parts[1]).toContain('(continued)');
    expect(parts[0]).toContain('Part 1 of ');
    // Every word of the long description survives, in order, exactly once.
    const seen = [...text.matchAll(/\bw(\d+)\b/g)].map((m) => Number(m[1]));
    expect(seen).toEqual(Array.from({ length: 4000 }, (_, i) => i + 1));
    for (let i = 2; i <= 30; i++) expect(text).toContain(`desc-${i} & <ok>`);
    // Items stay in chronological/title order across messages: every title appears once as a header.
    expect([...text.matchAll(/• Item (\d+)/g)].length).toBe(30);
  });

  it('keeps item boundaries: no part starts mid-item without a continuation header', async () => {
    const items = Array.from({ length: 40 }, (_, i) => task({ title: `T${String(i).padStart(2, '0')}`, description: 'x'.repeat(300), scheduled_start: cairo('09:00') }));
    const { parts } = renderTelegram(await snap({ tasks: items }));
    for (const p of parts.slice(1)) expect(p).toMatch(/^📋 <b>Tasks<\/b> <i>\(continued\)<\/i>\n\n• <b>T\d\d<\/b>/);
  });
});

describe('Both channels share one snapshot', () => {
  it('lists identical tasks and content in email and Telegram', async () => {
    const s = await snap({
      tasks: [task({ title: 'Alpha', scheduled_start: cairo('09:00') }), task({ title: 'Beta', due_date: cairo('17:00') }), task({ title: 'Gamma', is_all_day: true, due_date: cairo('00:00') })],
      content: [content({ title: 'Delta', scheduled_at: cairo('12:00') })],
    });
    const email = renderEmail(s).text;
    const tg = renderTelegram(s).text;
    for (const t of [...s.tasks, ...s.content]) {
      expect(email).toContain(t.title);
      expect(tg).toContain(t.title);
    }
    const order = (txt: string) => ['Alpha', 'Beta', 'Gamma', 'Delta'].sort((a, b) => txt.indexOf(a) - txt.indexOf(b));
    expect(order(email)).toEqual(order(tg));
  });
});

describe('Generator + dispatcher integration', () => {
  const fixture = () => {
    const finalized: any[] = [];
    let claimed = false;
    const base = makeAdmin({ tasks: [task({ title: 'Do it', scheduled_start: cairo('09:00') })] });
    base.db.tables.daily_briefing_preferences[0] = { user_id: 'u1', timezone: 'Africa/Cairo', enabled: true, email_enabled: true, telegram_enabled: true, email_consent_at: 'x' };
    base.db.tables.telegram_connections = [{ user_id: 'u1', chat_id: 42, status: 'active' }];
    base.db.rpcs.claim_briefing_deliveries = () => (claimed ? [] : ((claimed = true), [{ id: 'd1', user_id: 'u1', channel: 'telegram', local_date: DATE, claim_token: 't', attempt_count: 1 }]));
    base.db.rpcs.finalize_briefing_delivery = (a: any) => (finalized.push(a), true);
    const admin = createFakeAdmin(base.db, { users: { u1: { email: 'a@b.c', email_confirmed_at: 'now' } } });
    return { admin, finalized };
  };

  it('generates channel-specific messages', async () => {
    const { admin } = makeAdmin({ tasks: [task({ title: 'Do it', scheduled_start: cairo('09:00') })] });
    const g = createDailyBriefingGenerator(admin);
    const tg = await g.generate({ userId: 'u1', localDate: DATE, channel: 'telegram' });
    const em = await g.generate({ userId: 'u1', localDate: DATE, channel: 'email' });
    expect(tg.status === 'ready' && tg.message.parseMode === 'HTML' && tg.message.parts?.length).toBe(1);
    expect(em.status === 'ready' && em.message.html).toContain('Do it');
  });

  it('the dispatcher uses the real generator by default and sends parts via the adapter', async () => {
    const { admin, finalized } = fixture();
    const send = vi.fn(async () => ({ ok: true as const, providerMessageId: 'm1' }));
    const s = await dispatchDueBriefings(admin, { telegram: { send }, email: { send } });
    expect(s.sent).toBe(1);
    expect(finalized[0]).toMatchObject({ p_outcome: 'sent' });
    const msg = (send.mock.calls[0] as any)[1];
    expect(msg.parseMode).toBe('HTML');
    expect(msg.parts[0]).toContain('Do it');
  });

  it('opt-in is still enforced before any content is generated', async () => {
    const { admin, finalized } = fixture();
    const generator = { generate: vi.fn() };
    await (admin as any).from('daily_briefing_preferences').update({ enabled: false });
    await dispatchDueBriefings(admin, { generator: generator as any, telegram: { send: vi.fn() }, email: { send: vi.fn() } });
    expect(generator.generate).not.toHaveBeenCalled();
    expect(finalized[0]).toMatchObject({ p_outcome: 'skipped', p_error_code: 'briefing_disabled' });
  });
});

describe('Telegram adapter: multi-part delivery', () => {
  const OLD = process.env.TELEGRAM_BOT_TOKEN;
  beforeEach(() => { process.env.TELEGRAM_BOT_TOKEN = 'test-token'; });
  afterEach(() => { process.env.TELEGRAM_BOT_TOKEN = OLD; });
  const okRes = () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });

  it('sends parts in order with parse_mode=HTML', async () => {
    const f = vi.fn(async () => okRes());
    const r = await createTelegramAdapter(f as any).send({ chatId: 1 }, { channel: 'telegram', text: 'p', parts: ['one', 'two'], parseMode: 'HTML' });
    expect(r.ok).toBe(true);
    const bodies = f.mock.calls.map((c: any) => JSON.parse(c[1].body));
    expect(bodies.map((b: any) => b.text)).toEqual(['one', 'two']);
    expect(bodies.every((b: any) => b.parse_mode === 'HTML')).toBe(true);
  });

  it('plain single messages (manual test message) are unchanged: no parse_mode', async () => {
    const f = vi.fn(async () => okRes());
    await createTelegramAdapter(f as any).send({ chatId: 1 }, { channel: 'telegram', text: 'a <b> test' });
    const body = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(body.parse_mode).toBeUndefined();
    expect(body.text).toBe('a <b> test');
  });

  it('a failure after the first part is ambiguous (never retried, no duplicates)', async () => {
    const f = vi.fn().mockResolvedValueOnce(okRes()).mockResolvedValueOnce(new Response('{"ok":false}', { status: 500 }));
    const r = await createTelegramAdapter(f as any).send({ chatId: 1 }, { channel: 'telegram', text: 'p', parts: ['one', 'two'], parseMode: 'HTML' });
    expect(r).toMatchObject({ ok: false, kind: 'ambiguous', code: 'telegram_partial_delivery' });
  });

  it('a failure of the first part keeps its normal classification (retryable)', async () => {
    const f = vi.fn(async () => new Response('{"ok":false}', { status: 500 }));
    const r = await createTelegramAdapter(f as any).send({ chatId: 1 }, { channel: 'telegram', text: 'p', parts: ['one'], parseMode: 'HTML' });
    expect(r).toMatchObject({ ok: false, kind: 'transient' });
  });
});
