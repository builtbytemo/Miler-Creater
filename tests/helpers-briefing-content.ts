/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFakeAdmin } from './helpers-briefing-fake-db';

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export function task(over: Record<string, any> = {}) {
  return {
    id: uid(), workspace_id: 'w1', parent_task_id: null, project_id: null, milestone_id: null,
    title: 'Task', description: null, priority: 'medium', status: 'todo',
    scheduled_start: null, scheduled_end: null, due_date: null, estimated_duration_minutes: null,
    is_all_day: false, tags: [], recurrence_rule_id: null, occurrence_index: null,
    created_from: 'tasks', entry_type: 'task', assigned_to: null, ...over,
  };
}

export function content(over: Record<string, any> = {}) {
  return {
    id: uid(), workspace_id: 'w1', social_account_id: null, platform: 'linkedin', action_type: 'post',
    status: 'scheduled', title: 'Post', body: '', scheduled_at: null, duration_minutes: null,
    media_urls: [], external_links: [], target_reference: null, tags: [], notes: null,
    project_id: null, milestone_id: null, recurrence_rule_id: null, created_from: 'content', ...over,
  };
}

export interface World {
  members?: Array<{ workspace_id: string; user_id: string; role?: string }>;
  workspaces?: Array<{ id: string; name: string }>;
  tasks?: any[];
  content?: any[];
  projects?: any[];
  milestones?: any[];
  profiles?: any[];
  social_accounts?: any[];
  timezone?: string;
}

export function makeAdmin(w: World = {}) {
  const db: any = {
    tables: {
      workspace_members: (w.members ?? [{ workspace_id: 'w1', user_id: 'u1', role: 'member' }]).map((m) => ({ role: 'member', ...m })),
      workspaces: w.workspaces ?? [{ id: 'w1', name: 'Acme' }],
      tasks: w.tasks ?? [],
      content_items: w.content ?? [],
      projects: w.projects ?? [],
      milestones: w.milestones ?? [],
      profiles: w.profiles ?? [],
      social_accounts: w.social_accounts ?? [],
      daily_briefing_preferences: [{ user_id: 'u1', timezone: w.timezone ?? 'Africa/Cairo' }],
    },
    rpcs: {},
  };
  return { admin: createFakeAdmin(db), db };
}

/** 2026-11-11 (Wed), Africa/Cairo = UTC+2 -> local 09:00 is 07:00Z. */
export const DATE = '2026-11-11';
export const cairo = (hhmm: string, day = '2026-11-11') => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCHours(h - 2, m);
  return d.toISOString();
};
