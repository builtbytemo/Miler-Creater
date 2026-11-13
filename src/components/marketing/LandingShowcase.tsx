'use client';

import { useState, type KeyboardEvent } from 'react';
import {
  Calendar,
  Check,
  CheckSquare,
  Command,
  FileText,
  Lock,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { clsx } from 'clsx';
import { ZahiDiamondMark } from '@/components/brand/ZahiBrand';

type PreviewTabId = 'tasks' | 'calendar' | 'content' | 'security';

interface PreviewTask {
  id: string;
  title: string;
  project: string;
  due: string;
  priority: 'urgent' | 'high' | 'medium';
  subtasks: string;
  initialDone: boolean;
}

const PREVIEW_TASKS: PreviewTask[] = [
  {
    id: 't-1',
    title: 'Finalize Q4 product launch changelog thread',
    project: 'Editorial Launch',
    due: 'Today, 14:00',
    priority: 'urgent',
    subtasks: '3/4',
    initialDone: false,
  },
  {
    id: 't-2',
    title: 'Review recurring release checklist template',
    project: 'Core Workspace',
    due: 'Tomorrow',
    priority: 'high',
    subtasks: '2/2',
    initialDone: false,
  },
  {
    id: 't-3',
    title: 'Approve Cairo afternoon LinkedIn post slot',
    project: 'Distribution',
    due: 'Thu, 09:30',
    priority: 'medium',
    subtasks: '1/1',
    initialDone: true,
  },
];

const PREVIEW_CALENDAR_DAYS = [
  {
    day: 'Mon 16',
    items: [
      { label: 'Spec review freeze', kind: 'task' as const, time: '10:00' },
      { label: 'LinkedIn · Architecture notes', kind: 'content' as const, time: '16:30' },
    ],
  },
  {
    day: 'Tue 17',
    items: [
      { label: 'X · Shortcut workflow demo', kind: 'content' as const, time: '11:00' },
      { label: 'QA sign-off milestone', kind: 'task' as const, time: '15:00' },
    ],
  },
  {
    day: 'Wed 18',
    items: [
      { label: 'Threads · Weekly cadence', kind: 'content' as const, time: '13:15' },
      { label: 'Reddit · Dev log summary', kind: 'content' as const, time: '18:00' },
    ],
  },
];

const PREVIEW_CONTENT = [
  {
    platform: 'LinkedIn',
    title: 'How we unify task dependencies with editorial deadlines',
    status: 'Scheduled',
    badgeClass: 'badge-info',
    slot: 'Tue 17 · 11:00 EET',
  },
  {
    platform: 'X',
    title: 'Keyboard triage loop: / filter, n create, ⌘K jump',
    status: 'Review',
    badgeClass: 'badge-warning',
    slot: 'Wed 18 · 14:30 EET',
  },
  {
    platform: 'Threads',
    title: 'Keeping AI tools behind explicit OAuth confirmation gates',
    status: 'Draft',
    badgeClass: 'badge-neutral',
    slot: 'Thu 19 · Unscheduled',
  },
  {
    platform: 'Reddit',
    title: 'Designing multi-tenant RLS for calendar & content queues',
    status: 'Published',
    badgeClass: 'badge-success',
    slot: 'Mon 16 · Live',
  },
];

const TABS: {
  id: PreviewTabId;
  keyHint: string;
  label: string;
  icon: typeof CheckSquare;
}[] = [
  { id: 'tasks', keyHint: '1', label: 'Tasks', icon: CheckSquare },
  { id: 'calendar', keyHint: '2', label: 'Calendar', icon: Calendar },
  { id: 'content', keyHint: '3', label: 'Content', icon: FileText },
  { id: 'security', keyHint: '4', label: 'CLI & MCP', icon: Terminal },
];

function priorityBorder(priority: PreviewTask['priority']) {
  if (priority === 'urgent') return 'border-l-[var(--status-danger-text)]';
  if (priority === 'high') return 'border-l-[var(--status-warning-text)]';
  return 'border-l-[var(--border-strong)]';
}

export function LandingShowcase() {
  const [activeTab, setActiveTab] = useState<PreviewTabId>('tasks');
  const [completedIds, setCompletedIds] = useState<Record<string, boolean>>({
    't-3': true,
  });

  const toggleTask = (id: string) => {
    setCompletedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const openCount = PREVIEW_TASKS.filter((task) => !completedIds[task.id]).length;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.id === activeTab);
    if (idx === -1) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setActiveTab(TABS[(idx + 1) % TABS.length].id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setActiveTab(TABS[(idx - 1 + TABS.length) % TABS.length].id);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveTab(TABS[0].id);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveTab(TABS[TABS.length - 1].id);
    }
  };

  return (
    <div
      className="surface-elevated zahi-khatam-accent overflow-hidden"
      aria-label="Interactive Zahi workspace preview"
    >
      {/* Window chrome */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
            <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
          </div>
          <span className="ml-1.5 truncate text-xs font-medium text-[var(--text-primary)]">
            Studio Workspace
          </span>
          <ZahiDiamondMark size="xs" tone="accent" />
          <span className="hidden sm:inline font-mono text-[11px] text-[var(--text-muted)]">
            Africa/Cairo
          </span>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          <Command className="h-3 w-3 text-[var(--accent-text)]" aria-hidden="true" />
          <span>Command Bar</span>
          <kbd className="rounded bg-[var(--bg-surface-muted)] px-1 font-mono text-[10px] text-[var(--text-muted)]">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Tab switcher */}
      <div
        role="tablist"
        aria-label="Zahi workflow previews"
        onKeyDown={handleTabKeyDown}
        className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 sm:px-3 py-2"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'inline-flex shrink-0 items-center gap-1 sm:gap-1.5 rounded-[var(--radius-sm)] px-2 sm:px-2.5 py-1 sm:py-1.5 text-[11px] sm:text-xs font-medium transition-colors',
                isSelected
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border border-[var(--accent)]/25'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] border border-transparent'
              )}
            >
              <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
              <span>{tab.label}</span>
              <span className="hidden sm:inline font-mono text-[10px] opacity-70">
                {tab.keyHint}
              </span>
            </button>
          );
        })}
      </div>

      {/* Preview body */}
      <div className="p-4 sm:p-5 bg-[var(--bg-surface)] min-h-[280px] flex flex-col justify-between gap-4">
        {activeTab === 'tasks' && (
          <div className="space-y-3" role="tabpanel" aria-label="Tasks preview">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Priority Queue
                </span>
                <span className="badge-accent border rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums">
                  {openCount} open
                </span>
              </div>
              <span className="text-[11px] text-[var(--text-muted)]">
                Click row to toggle completion
              </span>
            </div>

            <div className="space-y-2">
              {PREVIEW_TASKS.map((task) => {
                const isDone = Boolean(completedIds[task.id]);
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    aria-pressed={isDone}
                    className={clsx(
                      'w-full text-left surface-well border border-[var(--border-subtle)] border-l-2 px-3 py-2.5 transition-colors hover:border-[var(--border-strong)] flex items-start justify-between gap-3',
                      priorityBorder(task.priority),
                      isDone && 'opacity-70'
                    )}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={clsx(
                          'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                          isDone
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)]'
                            : 'border-[var(--border-strong)] bg-[var(--bg-surface)]'
                        )}
                      >
                        {isDone && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                      </span>
                      <div className="min-w-0">
                        <p
                          className={clsx(
                            'text-xs font-medium text-[var(--text-primary)] leading-snug',
                            isDone && 'line-through text-[var(--text-muted)]'
                          )}
                        >
                          {task.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                          <span>{task.project}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {task.subtasks} subtasks
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
                      {task.due}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="space-y-3" role="tabpanel" aria-label="Calendar preview">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Shared Task &amp; Publishing Timeline
              </span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                Day · Week · Month
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {PREVIEW_CALENDAR_DAYS.map((col) => (
                <div
                  key={col.day}
                  className="surface-well border border-[var(--border-subtle)] p-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
                    <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
                      {col.day}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {col.items.length} items
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {col.items.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-1 text-[10px]">
                          <span
                            className={clsx(
                              'font-medium uppercase tracking-wide',
                              item.kind === 'content'
                                ? 'text-[var(--status-info-text)]'
                                : 'text-[var(--accent-text)]'
                            )}
                          >
                            {item.kind === 'content' ? 'Post' : 'Task'}
                          </span>
                          <span className="font-mono text-[var(--text-muted)] tabular-nums">
                            {item.time}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] font-medium text-[var(--text-primary)] leading-snug">
                          {item.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'content' && (
          <div className="space-y-3" role="tabpanel" aria-label="Content pipeline preview">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Multi-Channel Editorial Queue
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                LinkedIn · X · Threads · Reddit
              </span>
            </div>

            <div className="space-y-2">
              {PREVIEW_CONTENT.map((row) => (
                <div
                  key={row.title}
                  className="surface-well border border-[var(--border-subtle)] px-3 py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                        {row.platform}
                      </span>
                      <span
                        className={clsx(
                          row.badgeClass,
                          'border rounded-full px-1.5 py-0.5 text-[10px] font-medium'
                        )}
                      >
                        {row.status}
                      </span>
                    </div>
                    <p className="truncate text-xs text-[var(--text-secondary)]">
                      {row.title}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                    {row.slot}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-3" role="tabpanel" aria-label="CLI and MCP security preview">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Scoped Agent &amp; CLI Boundary
              </span>
              <span className="badge-success border rounded-full px-2 py-0.5 text-[10px] font-medium inline-flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                <span>OAuth 2.1 + PKCE</span>
              </span>
            </div>

            <div className="surface-well border border-[var(--border-subtle)] p-3 font-mono text-[11px] space-y-2 text-[var(--text-secondary)]">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
                <span className="text-[var(--text-primary)]">client: claude-mcp-remote</span>
                <span className="text-[var(--accent-text)]">scope: read write</span>
              </div>
              <p className="leading-relaxed">
                <span className="text-[var(--text-muted)]">01 </span>
                RLS policy verifies active workspace membership on every row query.
              </p>
              <p className="leading-relaxed">
                <span className="text-[var(--text-muted)]">02 </span>
                External write operations generate explicit confirmation tokens.
              </p>
              <p className="leading-relaxed">
                <span className="text-[var(--text-muted)]">03 </span>
                Scoped API &amp; CLI tokens remain hashed and revocable in one click.
              </p>
            </div>
          </div>
        )}

        {/* Footer status strip inside preview frame */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-muted)]">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent-text)]" aria-hidden="true" />
            <span>Isolated multi-tenant workspace · Light &amp; Dark themes</span>
          </div>
          <span className="font-mono text-[10px]">Press / or ⌘K inside app</span>
        </div>
      </div>
    </div>
  );
}
