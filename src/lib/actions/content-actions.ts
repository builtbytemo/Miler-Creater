'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyDomainEvent } from '@/lib/services/notification-service';
import type { Database } from '@/types/database';
import {
  getContentItems,
  getIdeaInboxItems,
  getContentItemById,
  createContentItem,
  updateContentItem,
  deleteContentItem,
  getSocialAccounts,
  createSocialAccount,
  type ContentItemWithMeta,
  type SocialAccountRow,
} from '@/lib/services/content-service';
import { getTasks, type TaskWithMeta } from '@/lib/services/task-service';
import {
  createContentSchema,
  updateContentSchema,
  createSocialAccountSchema,
  type CreateContentInput,
  type UpdateContentInput,
  type ContentFilterInput,
  type CreateSocialAccountInput,
} from '@/lib/validation/content';

export interface ContentActionResult<T = unknown> {
  success?: boolean;
  error?: string;
  data?: T;
}

import { resolveAuthorizedWorkspace } from '@/lib/auth/workspace';
export { resolveAuthorizedWorkspace };

/**
 * Extracts and normalizes form data into a structured object for content operations.
 */
function parseContentFormData(formData: FormData): {
  workspaceId?: string;
  contentId?: string;
  data: Record<string, unknown>;
} {
  const workspaceId = (formData.get('workspace_id') as string) || undefined;
  const contentId =
    (formData.get('content_id') as string) || (formData.get('id') as string) || undefined;
  const data: Record<string, unknown> = {};

  if (formData.has('platform')) {
    const val = formData.get('platform');
    if (typeof val === 'string' && val.trim()) data.platform = val.trim();
  }
  if (formData.has('action_type')) {
    const val = formData.get('action_type');
    if (typeof val === 'string' && val.trim()) data.action_type = val.trim();
  }
  if (formData.has('status')) {
    const val = formData.get('status');
    if (typeof val === 'string' && val.trim()) data.status = val.trim();
  }
  if (formData.has('title')) {
    const val = formData.get('title');
    data.title = typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
  }
  if (formData.has('body')) {
    const val = formData.get('body');
    if (typeof val === 'string') data.body = val;
  }
  if (formData.has('scheduled_at')) {
    const val = formData.get('scheduled_at');
    data.scheduled_at =
      typeof val === 'string' && val.trim().length > 0 ? new Date(val).toISOString() : null;
  }
  if (formData.has('duration_minutes')) {
    const val = formData.get('duration_minutes');
    data.duration_minutes =
      typeof val === 'string' && val.trim().length > 0 ? parseInt(val, 10) : null;
  }
  if (formData.has('notes')) {
    const val = formData.get('notes');
    data.notes = typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
  }
  if (formData.has('project_id')) {
    const val = formData.get('project_id');
    data.project_id = typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
  }
  if (formData.has('milestone_id')) {
    const val = formData.get('milestone_id');
    data.milestone_id = typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
  }
  if (formData.has('social_account_id')) {
    const val = formData.get('social_account_id');
    data.social_account_id = typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
  }
  if (formData.has('recurrence_rule_id')) {
    const val = formData.get('recurrence_rule_id');
    data.recurrence_rule_id = typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
  }

  // Tags
  if (formData.has('tags')) {
    const val = formData.get('tags');
    if (typeof val === 'string' && val.trim()) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) data.tags = parsed;
        else data.tags = val.split(',').map((t) => t.trim()).filter(Boolean);
      } catch {
        data.tags = val.split(',').map((t) => t.trim()).filter(Boolean);
      }
    }
  }

  // Target reference
  const targetUrl = formData.get('target_url');
  const targetPostId = formData.get('target_post_id');
  const targetAuthorHandle = formData.get('target_author_handle');
  const targetRefRaw = formData.get('target_reference');

  if (typeof targetRefRaw === 'string' && targetRefRaw.trim()) {
    try {
      data.target_reference = JSON.parse(targetRefRaw);
    } catch {
      // Ignored; Zod schema will catch invalid structure
    }
  } else if (targetUrl || targetPostId || targetAuthorHandle) {
    data.target_reference = {
      url: typeof targetUrl === 'string' && targetUrl.trim() ? targetUrl.trim() : null,
      post_id: typeof targetPostId === 'string' && targetPostId.trim() ? targetPostId.trim() : null,
      author_handle:
        typeof targetAuthorHandle === 'string' && targetAuthorHandle.trim()
          ? targetAuthorHandle.trim()
          : null,
    };
  }

  // Recurrence
  const frequency = formData.get('recurrence_frequency') as string;
  const intervalStr = formData.get('recurrence_interval') as string;
  if (frequency && frequency !== 'none') {
    data.recurrence = {
      frequency,
      interval: intervalStr ? parseInt(intervalStr, 10) : 1,
      timezone: 'Asia/Cairo',
    };
  }

  return { workspaceId, contentId, data };
}

function formatSafeError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => i.message).join('; ');
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'An unexpected error occurred while processing content';
}

/**
 * Creates a social content item. Supports both React form actions (FormData) and
 * direct programmatic client invocations.
 */
export async function createContentItemAction(
  payloadOrPrevState: FormData | (CreateContentInput & { workspace_id?: string }) | null | unknown,
  formData?: FormData
): Promise<ContentActionResult<ContentItemWithMeta>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    let candidateWorkspaceId: string | undefined;
    let inputData: unknown;

    if (formData instanceof FormData) {
      const parsed = parseContentFormData(formData);
      candidateWorkspaceId = parsed.workspaceId;
      inputData = parsed.data;
    } else if (payloadOrPrevState instanceof FormData) {
      const parsed = parseContentFormData(payloadOrPrevState);
      candidateWorkspaceId = parsed.workspaceId;
      inputData = parsed.data;
    } else if (typeof payloadOrPrevState === 'object' && payloadOrPrevState !== null) {
      const obj = payloadOrPrevState as Record<string, unknown>;
      candidateWorkspaceId = (obj.workspace_id as string) || undefined;
      const { workspace_id: _ws, ...rest } = obj;
      inputData = rest;
    } else {
      return { error: 'Invalid request payload' };
    }

    const { workspaceId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      candidateWorkspaceId
    );

    if (wsError || !workspaceId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const validatedInput = createContentSchema.parse(inputData);

    const created = await createContentItem(
      supabase,
      workspaceId,
      validatedInput,
      authData.user.id
    );

    revalidatePath('/content');
    revalidatePath('/calendar');
    revalidatePath('/dashboard');

    return { success: true, data: created };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Updates an existing content item with partial update semantics.
 */
export async function updateContentItemAction(
  payloadOrPrevState:
    | FormData
    | (UpdateContentInput & { workspace_id?: string; content_id: string })
    | null
    | unknown,
  formData?: FormData
): Promise<ContentActionResult<ContentItemWithMeta>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    let candidateWorkspaceId: string | undefined;
    let contentId: string | undefined;
    let inputData: unknown;

    if (formData instanceof FormData) {
      const parsed = parseContentFormData(formData);
      candidateWorkspaceId = parsed.workspaceId;
      contentId = parsed.contentId;
      inputData = parsed.data;
    } else if (payloadOrPrevState instanceof FormData) {
      const parsed = parseContentFormData(payloadOrPrevState);
      candidateWorkspaceId = parsed.workspaceId;
      contentId = parsed.contentId;
      inputData = parsed.data;
    } else if (typeof payloadOrPrevState === 'object' && payloadOrPrevState !== null) {
      const obj = payloadOrPrevState as Record<string, unknown>;
      candidateWorkspaceId = (obj.workspace_id as string) || undefined;
      contentId = (obj.content_id as string) || (obj.id as string) || undefined;
      const { workspace_id: _ws, content_id: _cid, id: _id, ...rest } = obj;
      inputData = rest;
    } else {
      return { error: 'Invalid request payload' };
    }

    if (!contentId) {
      return { error: 'Content ID is required' };
    }

    const { workspaceId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      candidateWorkspaceId
    );

    if (wsError || !workspaceId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const validatedInput = updateContentSchema.parse(inputData);

    const updated = await updateContentItem(supabase, workspaceId, contentId, validatedInput);

    // Notify content author if different from actor
    if (updated.created_by && updated.created_by !== authData.user.id) {
      try {
        if (validatedInput.status === 'scheduled') {
          const adminSupabase = createAdminClient();
          await notifyDomainEvent(adminSupabase, {
            workspaceId,
            recipientId: updated.created_by,
            actorId: authData.user.id,
            title: `Content Scheduled: ${updated.platform}`,
            message: `Content for ${updated.platform} has been scheduled${updated.scheduled_at ? ` for ${updated.scheduled_at}` : ''}.`,
            entityType: 'content_item',
            entityId: updated.id,
            idempotencyKey: `content_scheduled:${updated.id}:${updated.scheduled_at || updated.updated_at || 'scheduled'}`,
            preferenceCategory: 'notify_upcoming_content',
          });
        } else if (validatedInput.status === 'archived') {
          const adminSupabase = createAdminClient();
          await notifyDomainEvent(adminSupabase, {
            workspaceId,
            recipientId: updated.created_by,
            actorId: authData.user.id,
            title: `Content Archived: ${updated.platform}`,
            message: `Content for ${updated.platform} has been archived.`,
            entityType: 'content_item',
            entityId: updated.id,
            idempotencyKey: `content_archived:${updated.id}:${updated.updated_at || 'archived'}`,
            preferenceCategory: 'notify_status_changes',
          });
        }
      } catch (notifyErr) {
        console.warn('Failed to dispatch notification for updateContentItemAction:', notifyErr);
      }
    }

    revalidatePath('/content');
    revalidatePath('/calendar');
    revalidatePath('/dashboard');

    return { success: true, data: updated };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Deletes a content item, strictly scoped to workspace and content ID.
 */
export async function deleteContentItemAction(
  workspaceId: string,
  contentId: string
): Promise<ContentActionResult> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId || !contentId) {
      return { error: 'Workspace ID and Content ID are required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    await deleteContentItem(supabase, authWsId, contentId);

    revalidatePath('/content');
    revalidatePath('/calendar');
    revalidatePath('/dashboard');

    return { success: true };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Retrieves a single content item by ID for detail modal presentation.
 */
export async function getContentItemByIdAction(
  workspaceId: string,
  contentId: string
): Promise<ContentActionResult<ContentItemWithMeta>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId || !contentId) {
      return { error: 'Workspace ID and Content ID are required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const item = await getContentItemById(supabase, authWsId, contentId);
    if (!item) {
      return { error: 'Content item not found' };
    }

    return { success: true, data: item };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Retrieves content items for client workspace filtering.
 */
export async function getContentItemsAction(
  workspaceId?: string,
  filter?: ContentFilterInput
): Promise<ContentActionResult<ContentItemWithMeta[]>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const items = await getContentItems(supabase, authWsId, filter);
    return { success: true, data: items };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

export interface CalendarEventsPayload {
  content: ContentItemWithMeta[];
  tasks: TaskWithMeta[];
}

/**
 * High-performance composite action to retrieve both content items and tasks for a calendar period.
 * Executes auth and workspace resolution once, then runs database queries in parallel.
 */
export async function getCalendarEventsAction(
  workspaceId: string,
  filter: { scheduled_from: string; scheduled_to: string }
): Promise<ContentActionResult<CalendarEventsPayload>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const [content, tasks] = await Promise.all([
      getContentItems(supabase, authWsId, {
        scheduled_from: filter.scheduled_from,
        scheduled_to: filter.scheduled_to,
      }),
      getTasks(supabase, authWsId, {
        scheduled_from: filter.scheduled_from,
        scheduled_to: filter.scheduled_to,
        parent_task_id: null,
      }),
    ]);

    return {
      success: true,
      data: { content, tasks },
    };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Retrieves Idea Inbox items (status = 'idea' and scheduled_at IS NULL).
 */
export async function getIdeaInboxItemsAction(
  workspaceId?: string
): Promise<ContentActionResult<ContentItemWithMeta[]>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const items = await getIdeaInboxItems(supabase, authWsId);
    return { success: true, data: items };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Retrieves configured social platform accounts for the active workspace.
 */
export async function getSocialAccountsAction(
  workspaceId?: string
): Promise<ContentActionResult<SocialAccountRow[]>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const accounts = await getSocialAccounts(supabase, authWsId);
    return { success: true, data: accounts };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}

/**
 * Creates a social account handle within a workspace.
 */
export async function createSocialAccountAction(
  workspaceId: string,
  input: CreateSocialAccountInput
): Promise<ContentActionResult<SocialAccountRow>> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return { error: 'Authentication required' };
    }

    if (!workspaceId) {
      return { error: 'Workspace ID is required' };
    }

    const { workspaceId: authWsId, error: wsError } = await resolveAuthorizedWorkspace(
      supabase,
      authData.user.id,
      workspaceId
    );

    if (wsError || !authWsId) {
      return { error: wsError || 'Workspace access denied' };
    }

    const validated = createSocialAccountSchema.parse(input);
    const created = await createSocialAccount(supabase, authWsId, validated);

    revalidatePath('/content');
    revalidatePath('/calendar');

    return { success: true, data: created };
  } catch (err) {
    return { error: formatSafeError(err) };
  }
}
