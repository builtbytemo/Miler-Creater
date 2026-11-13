import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  ArrowRight,
  Bell,
  Calendar,
  CheckSquare,
  Database,
  FileText,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import {
  ZahiDiamondMark,
  ZahiLogoMark,
  ZahiMascot,
  ZahiWordmark,
} from '@/components/brand/ZahiBrand';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { LandingShowcase } from '@/components/marketing/LandingShowcase';

export const instant = false;

const WORKFLOW_PILLARS = [
  {
    icon: CheckSquare,
    title: 'Hierarchical Tasks',
    description:
      'Break milestones into subtasks with urgency levels, recurrence rules, inline completion, and overdue triage.',
  },
  {
    icon: Calendar,
    title: 'Unified Calendar',
    description:
      'Day, week, and month views combining task deadlines and scheduled content slots in your IANA timezone.',
  },
  {
    icon: FileText,
    title: 'Content Pipeline',
    description:
      'Manage LinkedIn, Reddit, Threads, and X drafts from ideation and review through scheduled publication.',
  },
  {
    icon: Bell,
    title: 'Briefings & Inbox',
    description:
      'Automated due-soon and overdue alerts alongside configurable daily summary digests delivered on your schedule.',
  },
];

const ARCHITECTURE_ROWS = [
  {
    icon: Database,
    title: 'Multi-Tenant Schema',
    description:
      'Normalized tables, strict Row Level Security, and complete workspace membership isolation on every query.',
  },
  {
    icon: Calendar,
    title: 'Unified Calendar Index',
    description:
      'Composite indexed queries bridging social content items and task deadlines without client-side drift.',
  },
  {
    icon: ShieldCheck,
    title: 'AI Security Boundary',
    description:
      'Scoped CLI & API tokens, OAuth 2.1 + PKCE remote MCP consent, mutation confirmations, and immutable audit logging.',
  },
];

export default async function HomePage() {
  await connection();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isEnvConfigured = supabaseUrl && !supabaseUrl.includes('your-project-ref');

  if (isEnvConfigured) {
    let hasUser = false;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        hasUser = true;
      }
    } catch {
      // Allow page to render if DB is not connected yet
    }

    if (hasUser) {
      redirect('/dashboard');
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/92 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-6 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-[var(--radius-sm)]"
            >
              <ZahiLogoMark size="md" />
              <ZahiWordmark className="text-sm" />
            </Link>

            <nav
              aria-label="Landing sections"
              className="hidden md:flex items-center gap-5 text-xs font-medium text-[var(--text-secondary)]"
            >
              <a
                href="#workflows"
                className="hover:text-[var(--text-primary)] transition-colors"
              >
                Workflows
              </a>
              <a
                href="#architecture"
                className="hover:text-[var(--text-primary)] transition-colors"
              >
                Architecture
              </a>
              <a
                href="#security"
                className="hover:text-[var(--text-primary)] transition-colors"
              >
                Security &amp; AI
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle variant="compact" className="h-8 w-8" />
            <Link
              href="/auth/sign-in"
              className="text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/auth/sign-up"
              className="btn-accent text-xs px-3 sm:px-3.5 py-1.5"
            >
              Create account
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {/* Asymmetric Hero + Interactive Product Frame */}
        <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-10 pb-12 sm:pt-14 sm:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
            <div className="lg:col-span-5 flex flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
                <ZahiDiamondMark size="xs" tone="accent" />
                <span>Unified Content &amp; Task Command Center</span>
              </div>

              <h1 className="mt-4 heading-display text-3xl sm:text-[2.6rem] leading-[1.06] tracking-[-0.03em]">
                Tasks, publishing, and AI boundaries in one quiet workspace.
              </h1>

              <p className="mt-4 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed max-w-lg">
                Operate LinkedIn, Reddit, Threads, and X publishing alongside hierarchical task
                dependencies, timezone-accurate calendar planning, daily briefings, and scoped
                CLI &amp; MCP access.
              </p>

              <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                <Link href="/auth/sign-up" className="btn-accent px-5 py-2.5 text-sm">
                  <span>Open Zahi</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/auth/sign-in"
                  className="btn-secondary px-5 py-2.5 text-sm text-[var(--text-secondary)]"
                >
                  Sign In to Existing Workspace
                </Link>
              </div>

              <dl className="mt-8 w-full border-t border-[var(--border-subtle)] pt-5 grid grid-cols-3 gap-4">
                <div>
                  <dt className="text-[11px] font-medium text-[var(--text-muted)]">
                    Navigation
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold text-[var(--text-primary)]">
                    ⌘K &amp; Shortcut-first
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-[var(--text-muted)]">
                    Isolation
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold text-[var(--text-primary)]">
                    Strict Postgres RLS
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-[var(--text-muted)]">
                    Auth Boundary
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold text-[var(--text-primary)]">
                    OAuth 2.1 + PKCE
                  </dd>
                </div>
              </dl>
            </div>

            <div className="lg:col-span-7 w-full">
              <LandingShowcase />
            </div>
          </div>
        </section>

        {/* Workflows Matrix */}
        <section
          id="workflows"
          className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/35 py-12"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div>
                <p className="label-eyebrow">Operational Workflows</p>
                <h2 className="mt-1 heading-section text-xl sm:text-2xl">
                  Built for daily execution without tab sprawl
                </h2>
              </div>
              <p className="text-xs text-[var(--text-muted)] max-w-sm">
                Every view shares the same workspace data model, keyboard controls, and light/dark
                design system.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {WORKFLOW_PILLARS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="surface-card p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                      <Icon
                        className="w-4 h-4 shrink-0 text-[var(--accent-text)]"
                        aria-hidden="true"
                      />
                      <span>{item.title}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Architecture & Security Boundary */}
        <section id="architecture" className="border-t border-[var(--border-subtle)] py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 surface-card p-5 sm:p-6 space-y-4">
                <div>
                  <p className="label-eyebrow">System Foundation</p>
                  <h2 className="mt-1 heading-section text-lg sm:text-xl">
                    Verifiable isolation between workspaces, data, and AI agents
                  </h2>
                </div>

                <div className="divide-y divide-[var(--border-subtle)]">
                  {ARCHITECTURE_ROWS.map((row) => {
                    const Icon = row.icon;
                    return (
                      <div key={row.title} className="py-3.5 first:pt-1 last:pb-0 flex gap-3">
                        <Icon
                          className="w-4 h-4 mt-0.5 shrink-0 text-[var(--accent-text)]"
                          aria-hidden="true"
                        />
                        <div className="space-y-1">
                          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                            {row.title}
                          </h3>
                          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                            {row.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                id="security"
                className="lg:col-span-5 surface-card p-5 sm:p-6 flex flex-col justify-between gap-5"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ZahiDiamondMark size="xs" tone="accent" />
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        Runtime Specifications
                      </span>
                    </div>
                    <span className="badge-neutral border rounded-full px-2 py-0.5 text-[10px] font-mono inline-flex items-center gap-1">
                      <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>Scoped Access</span>
                    </span>
                  </div>

                  <dl className="surface-well border border-[var(--border-subtle)] p-3.5 space-y-2.5 font-mono text-[11px]">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">Workspace Auth</dt>
                      <dd className="text-[var(--text-primary)]">Session + Google OAuth</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">MCP &amp; Agents</dt>
                      <dd className="text-[var(--text-primary)]">OAuth 2.1 · S256 PKCE</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">Timezones</dt>
                      <dd className="text-[var(--text-primary)]">Validated IANA Engine</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">UI Parity</dt>
                      <dd className="text-[var(--text-primary)]">Light · Dark · Responsive</dd>
                    </div>
                  </dl>
                </div>

                {/* Quiet unboxed mascot colophon signature */}
                <div className="border-t border-[var(--border-subtle)] pt-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <ZahiMascot size={40} decorative />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        Ready to step inside?
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] truncate">
                        Set up your workspace in under a minute.
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/auth/sign-up"
                    className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  >
                    Create account
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <ZahiLogoMark size="xs" />
            <span>Zahi • Unified Content &amp; Task Command Center</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/auth/sign-in" className="hover:text-[var(--text-primary)] transition-colors">
              Sign in
            </Link>
            <Link href="/auth/sign-up" className="hover:text-[var(--text-primary)] transition-colors">
              Create account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
