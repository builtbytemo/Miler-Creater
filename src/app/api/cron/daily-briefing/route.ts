import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { enqueueDueBriefings } from '@/lib/briefing/scheduler';
import { dispatchDueBriefings } from '@/lib/briefing/dispatcher';

const STAGING_PROJECT_REF = 'prmgrrzqtnygmitplkhn';
const PRODUCTION_PROJECT_REF = 'zcpdpizrbaaekteurwup';

function authorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/**
 * Daily Briefing scheduler tick. Invoke every ~5 minutes from an external scheduler with
 * `Authorization: Bearer <CRON_SECRET>` (same convention as /api/cron/reminders).
 * Does nothing unless DAILY_BRIEFING_DELIVERY_ENABLED === 'true' (production kill switch).
 *
 * Environment-aware target guard:
 * - VERCEL_ENV === 'preview': Strictly requires Staging Supabase (prmgrrzqtnygmitplkhn.supabase.co).
 * - VERCEL_ENV === 'production': Strictly requires Production Supabase (zcpdpizrbaaekteurwup.supabase.co).
 * - Any other environment or host mismatch: Fails closed with HTTP 403.
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ error: 'Scheduler secret is not configured' }, { status: 500 });
  }
  if (!authorized(request.headers.get('authorization'), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Environment-aware Supabase host isolation safeguard
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';

  let hostname: string;
  try {
    hostname = new URL(supabaseUrl).hostname.toLowerCase();
  } catch {
    console.error('[Daily Briefing Cron] FATAL: Supabase URL is invalid or unparseable');
    return NextResponse.json(
      { error: 'Invalid Supabase URL configuration' },
      { status: 403 }
    );
  }

  const STAGING_HOST = `${STAGING_PROJECT_REF}.supabase.co`;
  const PRODUCTION_HOST = `${PRODUCTION_PROJECT_REF}.supabase.co`;

  let expectedHost: string;
  if (vercelEnv === 'preview') {
    expectedHost = STAGING_HOST;
  } else if (vercelEnv === 'production') {
    expectedHost = PRODUCTION_HOST;
  } else {
    console.error(`[Daily Briefing Cron] FATAL: Invalid or unsupported VERCEL_ENV: "${vercelEnv}"`);
    return NextResponse.json(
      { error: 'Invalid or unsupported runtime environment' },
      { status: 403 }
    );
  }

  if (hostname !== expectedHost) {
    console.error(
      `[Daily Briefing Cron] FATAL: Supabase target mismatch for environment "${vercelEnv}": expected "${expectedHost}", got "${hostname}"`
    );
    return NextResponse.json(
      { error: `Supabase target mismatch: ${expectedHost} required for ${vercelEnv} environment` },
      { status: 403 }
    );
  }

  if (process.env.DAILY_BRIEFING_DELIVERY_ENABLED !== 'true') {
    return NextResponse.json({ success: true, enabled: false, message: 'Daily Briefing delivery is disabled' });
  }

  try {
    const admin = createAdminClient();
    const enqueue = await enqueueDueBriefings(admin);
    const dispatch = await dispatchDueBriefings(admin);
    console.log('[Daily Briefing Cron] Tick summary:', {
      enqueued: enqueue.enqueued,
      evaluatedUsers: enqueue.evaluatedUsers,
      claimed: dispatch.claimed,
      sent: dispatch.sent,
      skipped: dispatch.skipped,
      failed: dispatch.failed,
      retried: dispatch.retried,
      ambiguous: dispatch.ambiguous,
    });
    return NextResponse.json({ success: true, enabled: true, enqueue, dispatch });
  } catch (err) {
    console.error('[Daily Briefing Cron] error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
