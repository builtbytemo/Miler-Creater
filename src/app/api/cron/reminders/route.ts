import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processAllReminders } from '@/lib/services/reminder-service';

/**
 * Handles incoming scheduled reminder cron requests.
 * 
 * Security and operational invariants:
 * 1. Requires secret bearer token authorization (Authorization: Bearer <CRON_SECRET>).
 * 2. Fails closed (HTTP 500) if CRON_SECRET is not configured in server environment.
 * 3. Rejects invalid or missing bearer headers with HTTP 401 without running the processor.
 * 4. Never exposes secrets, internal database connection strings, or full stack traces in responses.
 * 5. Uses bounded batch queries (default 100 items per category) to prevent memory exhaustion or serverless timeouts.
 * 6. Supports both GET (standard for Vercel Cron) and POST (standard for GitHub Actions and webhook triggers).
 */
async function handleCron(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[Reminder Cron Error] CRON_SECRET is not configured on the server.');
    return NextResponse.json(
      { error: 'Scheduler secret is not configured' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const adminSupabase = createAdminClient();
    const result = await processAllReminders(adminSupabase);

    return NextResponse.json({
      success: result.success,
      referenceTime: result.referenceTime,
      totalCreated: result.totalCreated,
      totalDuplicates: result.totalDuplicates,
      totalSkipped: result.totalSkipped,
      totalErrors: result.totalErrors,
      durationMs: result.durationMs,
      summary: {
        upcomingTasks: {
          evaluated: result.results.upcomingTasks.evaluated,
          created: result.results.upcomingTasks.created,
          duplicates: result.results.upcomingTasks.duplicates,
          skipped: result.results.upcomingTasks.skipped,
          errors: result.results.upcomingTasks.errors,
        },
        overdueTasks: {
          evaluated: result.results.overdueTasks.evaluated,
          created: result.results.overdueTasks.created,
          duplicates: result.results.overdueTasks.duplicates,
          skipped: result.results.overdueTasks.skipped,
          errors: result.results.overdueTasks.errors,
        },
        upcomingContent: {
          evaluated: result.results.upcomingContent.evaluated,
          created: result.results.upcomingContent.created,
          duplicates: result.results.upcomingContent.duplicates,
          skipped: result.results.upcomingContent.skipped,
          errors: result.results.upcomingContent.errors,
        },
      },
    });
  } catch (err) {
    console.error(
      '[Reminder Cron Error] Unexpected exception during reminder run:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return NextResponse.json(
      { error: 'Internal server error processing reminders' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
