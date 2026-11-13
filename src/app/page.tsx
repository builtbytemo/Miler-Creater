import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ArrowRight, ShieldCheck, Database, Calendar } from 'lucide-react';
import { ZahiLogoMark, ZahiWordmark } from '@/components/brand/ZahiBrand';

export const instant = false;

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
      {/* Navigation */}
      <header className="border-b border-[var(--border-subtle)] px-6 py-3.5 flex items-center justify-between max-w-7xl w-full mx-auto">
        <div className="flex items-center gap-2.5">
          <ZahiLogoMark size="md" />
          <ZahiWordmark className="text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/auth/sign-in"
            className="text-xs font-medium px-3 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-up"
            className="btn-accent text-xs px-3.5 py-1.5"
          >
            Create account
          </Link>
        </div>
      </header>

      {/* Main Focus */}
      <main className="flex-1 flex flex-col justify-center items-center px-6 py-12 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium badge-accent border mb-5">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Productivity · Content · AI Workspace</span>
        </div>

        <h1 className="heading-display text-3xl sm:text-5xl max-w-2xl leading-[1.08]">
          Zahi — Unified Content &amp; Task Command Center
        </h1>

        <p className="mt-4 text-sm sm:text-base text-[var(--text-secondary)] max-w-xl leading-relaxed">
          High-performance operations for LinkedIn, Reddit, Threads, and X content alongside
          hierarchical task dependencies and server-side calendar planning.
        </p>

        <div className="mt-7 flex flex-col sm:flex-row items-center gap-3">
          <Link
            href="/auth/sign-up"
            className="w-full sm:w-auto btn-accent px-5 py-2.5 text-sm"
          >
            <span>Open Zahi</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <Link
            href="/auth/sign-in"
            className="w-full sm:w-auto btn-secondary px-5 py-2.5 text-sm text-[var(--text-secondary)]"
          >
            Sign In to Existing Workspace
          </Link>
        </div>

        {/* Technical Architecture Foundation */}
        <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left w-full">
          <div className="surface-card p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <Database className="w-4 h-4 text-[var(--accent-text)]" aria-hidden="true" />
              <span>Multi-Tenant Schema</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Normalized tables, strict Row Level Security, and complete workspace isolation.
            </p>
          </div>

          <div className="surface-card p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <Calendar className="w-4 h-4 text-[var(--accent-text)]" aria-hidden="true" />
              <span>Unified Calendar</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Composite indexed queries bridging social content items and task deadlines.
            </p>
          </div>

          <div className="surface-card p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <ShieldCheck className="w-4 h-4 text-[var(--accent-text)]" aria-hidden="true" />
              <span>AI Security Boundary</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Scoped CLI tokens, confirmation requests for mutations, and immutable audit logging.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)] px-6 py-5 text-center text-xs text-[var(--text-muted)]">
        Zahi • Content &amp; Task Command Center
      </footer>
    </div>
  );
}
