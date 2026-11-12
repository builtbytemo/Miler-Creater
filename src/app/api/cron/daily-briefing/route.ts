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
 * Strictly requires Staging Supabase (prmgrrzqtnygmitplkhn) and refuses production (zcpdpizrbaaekteurwup).
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ error: 'Scheduler secret is not configured' }, { status: 500 });
  }
  if (!authorized(request.headers.get('authorization'), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Production isolation safeguard: verify Supabase configuration points to staging, not production.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  if (supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    console.error('[Daily Briefing Cron] FATAL: Production Supabase instance targeted by cron endpoint!');
    return NextResponse.json(
      { error: 'Refusing to execute cron against production Supabase instance' },
      { status: 403 }
    );
  }
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    console.error('[Daily Briefing Cron] FATAL: Staging Supabase instance (prmgrrzqtnygmitplkhn) is not targeted!');
    return NextResponse.json(
      { error: 'Invalid Supabase environment: Staging project ref required' },
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
