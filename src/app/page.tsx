import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ArrowRight, ShieldCheck, Database, Calendar } from 'lucide-react';

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
    <div className="min-h-screen flex flex-col justify-between bg-neutral-950 text-neutral-100 font-sans">
      {/* Navigation */}
      <header className="border-b border-neutral-800/80 px-6 py-4 flex items-center justify-between max-w-7xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-sm">
            CC
          </div>
          <span className="font-semibold text-sm tracking-tight text-neutral-200">
            Command Center
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/auth/sign-in"
            className="text-xs font-medium px-3.5 py-2 rounded-lg text-neutral-300 hover:text-neutral-100 hover:bg-neutral-900 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-up"
            className="text-xs font-medium px-3.5 py-2 rounded-lg bg-neutral-100 text-neutral-950 hover:bg-white transition-colors"
          >
            Create account
          </Link>
        </div>
      </header>

      {/* Main Focus */}
      <main className="flex-1 flex flex-col justify-center items-center px-6 py-16 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 mb-6">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Phase 1 Architecture Foundation Established</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-neutral-100 max-w-2xl leading-tight">
          Unified Content & Task Command Center
        </h1>

        <p className="mt-4 text-base text-neutral-400 max-w-xl leading-relaxed">
          High-performance operations for LinkedIn, Reddit, Threads, and X content alongside
          hierarchical task dependencies and server-side calendar planning.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
          <Link
            href="/auth/sign-up"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-colors shadow-sm"
          >
            <span>Open Command Center</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/auth/sign-in"
            className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-3 rounded-xl border border-neutral-800 hover:bg-neutral-900 text-neutral-300 font-medium text-sm transition-colors"
          >
            Sign In to Existing Workspace
          </Link>
        </div>

        {/* Technical Architecture Foundation Badges */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left w-full">
          <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-300">
              <Database className="w-4 h-4 text-blue-400" />
              <span>Multi-Tenant Schema</span>
            </div>
            <p className="text-xs text-neutral-400">
              14 normalized tables, strict Row Level Security, and workspace isolation.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-300">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span>Unified Calendar</span>
            </div>
            <p className="text-xs text-neutral-400">
              Composite indexed queries bridging social content items and task deadlines.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>AI Security Boundary</span>
            </div>
            <p className="text-xs text-neutral-400">
              Scoped tokens, confirmation requests for mutations, and immutable audit logging.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-800/80 px-6 py-6 text-center text-xs text-neutral-400">
        Personal-first Content & Task Command Center • Standalone Architecture
      </footer>
    </div>
  );
}
