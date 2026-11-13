import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ArrowRight, CheckSquare, Calendar, Sparkles } from 'lucide-react';
import {
  ZahiCornerBracket,
  ZahiLogoMark,
  ZahiMascot,
  ZahiWordmark,
} from '@/components/brand/ZahiBrand';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export const instant = false;

const PLATFORM_PILLARS = [
  {
    icon: CheckSquare,
    title: 'Tasks & Dependencies',
    description:
      'Track deadlines, subtasks, blockers, and urgent priorities in a fast keyboard-friendly workspace.',
  },
  {
    icon: Calendar,
    title: 'Unified Calendar & Publishing',
    description:
      'Coordinate daily time blocks alongside scheduled LinkedIn, Reddit, Threads, and X campaigns.',
  },
  {
    icon: Sparkles,
    title: 'Daily Briefings, CLI & AI',
    description:
      'Receive automated morning briefings and connect AI assistants or terminal workflows with scoped tokens.',
  },
] as const;

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
    <div className="min-h-screen flex flex-col justify-between bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans">
      {/* Top Navigation */}
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-glass)] backdrop-blur-md">
        <div className="px-5 sm:px-8 py-3.5 flex items-center justify-between gap-4 max-w-6xl w-full mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 text-[var(--text-primary)]"
          >
            <ZahiLogoMark size="md" />
            <ZahiWordmark className="text-xl leading-none" />
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle variant="compact" />
            <Link
              href="/auth/sign-in"
              className="btn-secondary px-3.5 py-1.5 text-xs"
            >
              Sign in
            </Link>
            <Link
              href="/auth/sign-up"
              className="btn-accent px-3.5 py-1.5 text-xs"
            >
              Create account
            </Link>
          </div>
        </div>
      </header>

      {/* Main Editorial Entrance */}
      <main className="flex-1 flex flex-col justify-center items-center px-5 sm:px-8 py-12 sm:py-16 max-w-5xl w-full mx-auto">
        <div className="relative w-full surface-card px-6 py-10 sm:px-12 sm:py-14 text-center overflow-hidden">
          <ZahiCornerBracket position="top-left" />
          <ZahiCornerBracket position="top-right" />

          <div className="relative z-10 flex flex-col items-center">
            <ZahiMascot
              variant="medallion"
              priority={true}
              imgClassName="w-28 sm:w-32 h-auto"
              className="mb-5"
            />

            <p className="font-brand-serif text-lg sm:text-xl font-semibold uppercase tracking-[0.26em] text-[var(--accent-text)] mb-3">
              Zahi
            </p>

            <h1 className="heading-display text-3xl sm:text-5xl max-w-2xl leading-[1.08]">
              Unified Content &amp; Task Command Center
            </h1>

            <p className="mt-4 text-sm sm:text-base text-[var(--text-secondary)] max-w-xl leading-relaxed">
              Bring focused task execution, unified calendar blocking, multi-platform content planning,
              automated daily briefings, and CLI workflows into one calm workspace.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
              <Link
                href="/auth/sign-up"
                className="btn-accent w-full sm:w-auto px-5 py-2.5 text-sm"
              >
                <span>Open Zahi</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link
                href="/auth/sign-in"
                className="btn-secondary w-full sm:w-auto px-5 py-2.5 text-sm"
              >
                Sign In to Existing Workspace
              </Link>
            </div>
          </div>
        </div>

        {/* Workspace Capabilities Strip */}
        <section
          aria-label="Workspace capabilities"
          className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-left w-full"
        >
          {PLATFORM_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div key={pillar.title} className="surface-card p-5 space-y-2">
                <div className="flex items-center gap-2.5 text-xs font-semibold text-[var(--text-primary)]">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-text)]">
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  <span>{pillar.title}</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {pillar.description}
                </p>
              </div>
            );
          })}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)] px-6 py-5 text-center text-xs text-[var(--text-muted)]">
        Zahi • Content &amp; Task Command Center
      </footer>
    </div>
  );
}
