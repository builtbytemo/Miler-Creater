import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  SocialPlatform,
  ContentActionType,
  ContentStatus,
  Json,
} from '@/types/database';
import {
  createContentSchema,
  updateContentSchema,
  contentFilterSchema,
  createSocialAccountSchema,
  type CreateContentInput,
  type UpdateContentInput,
  type ContentFilterInput,
  type CreateSocialAccountInput,
} from '@/lib/validation/content';

export interface ContentItemWithMeta {
  id: string;
  workspace_id: string;
  social_account_id: string | null;
  platform: SocialPlatform;
  action_type: ContentActionType;
  status: ContentStatus;
  title: string | null;
  body: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  media_urls: Json;
  external_links: Json;
  target_reference: Json | null;
  tags: string[];
  notes: string | null;
  project_id: string | null;
  milestone_id: string | null;
  recurrence_rule_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Expanded relations
  project?: { id: string; name: string; color: string | null } | null;
  social_account?: {
    id: string;
    platform: SocialPlatform;
    account_handle: string;
    account_name: string | null;
    avatar_url: string | null;
  } | null;
}

export type SocialAccountRow = Database['public']['Tables']['social_accounts']['Row'];

const CONTENT_SELECT_FIELDS = `
  *,
  projects (id, name, color),
  social_accounts (id, platform, account_handle, account_name, avatar_url)
`;

function formatContentItem(raw: Record<string, unknown>): ContentItemWithMeta {
  const project = (raw as { projects?: { id: string; name: string; color: string | null } }).projects;
  const socialAccount = (raw as {
    social_accounts?: {
      id: string;
      platform: SocialPlatform;
      account_handle: string;
      account_name: string | null;
      avatar_url: string | null;
    };
  }).social_accounts;

  return {
    ...(raw as unknown as Database['public']['Tables']['content_items']['Row']),
    project: project || null,
    social_account: socialAccount || null,
  };
}

/**
 * Retrieves content items for a workspace with flexible filtering across platform,
 * status, action type, date range, search query, and Idea Inbox classification.
 */
export async function getContentItems(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  filter: ContentFilterInput = {}
): Promise<ContentItemWithMeta[]> {
  const validatedFilter = contentFilterSchema.parse(filter);

  let query = supabase
    .from('content_items')
    .select(CONTENT_SELECT_FIELDS)
    .eq('workspace_id', workspaceId)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  // Filter: Platform (single value or array)
  if (validatedFilter.platform) {
    if (Array.isArray(validatedFilter.platform)) {
      query = query.in('platform', validatedFilter.platform);
    } else {
      query = query.eq('platform', validatedFilter.platform);
    }
  }

  // Filter: Status (single value or array)
  if (validatedFilter.status) {
    if (Array.isArray(validatedFilter.status)) {
      query = query.in('status', validatedFilter.status);
    } else {
      query = query.eq('status', validatedFilter.status);
    }
  }

  // Filter: Action Type (single value or array)
  if (validatedFilter.action_type) {
    if (Array.isArray(validatedFilter.action_type)) {
      query = query.in('action_type', validatedFilter.action_type);
    } else {
      query = query.eq('action_type', validatedFilter.action_type);
    }
  }

  // Filter: Project ID
  if (validatedFilter.project_id) {
    query = query.eq('project_id', validatedFilter.project_id);
  }

  // Filter: Social Account ID
  if (validatedFilter.social_account_id) {
    query = query.eq('social_account_id', validatedFilter.social_account_id);
  }

  // Filter: Idea Inbox (items with status = 'idea' and scheduled_at IS NULL)
  // An Idea Inbox item is specifically: status = 'idea' AND scheduled_at IS NULL.
  // The logical negation (is_idea === false) is: status != 'idea' OR scheduled_at IS NOT NULL.
  // This correctly includes unscheduled drafts, scheduled drafts, and scheduled ideas,
  // partitioning workspace content items into two mutually exclusive sets.
  if (validatedFilter.is_idea === true) {
    query = query.eq('status', 'idea').is('scheduled_at', null);
  } else if (validatedFilter.is_idea === false) {
    query = query.or('status.neq.idea,scheduled_at.not.is.null');
  }

  // Filter: Scheduled vs Unscheduled
  if (validatedFilter.is_scheduled === true) {
    query = query.not('scheduled_at', 'is', null);
  } else if (validatedFilter.is_scheduled === false) {
    query = query.is('scheduled_at', null);
  }

  // Filter: Scheduled Date Range
  if (validatedFilter.scheduled_from) {
    query = query.gte('scheduled_at', validatedFilter.scheduled_from);
  }
  if (validatedFilter.scheduled_to) {
    query = query.lte('scheduled_at', validatedFilter.scheduled_to);
  }

  // Filter: Search in title or body
  if (validatedFilter.search && validatedFilter.search.trim().length > 0) {
    const term = validatedFilter.search.trim();
    query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
  }

  // Filter: Tags
  if (validatedFilter.tags) {
    const tagList = Array.isArray(validatedFilter.tags)
      ? validatedFilter.tags
      : [validatedFilter.tags];
    if (tagList.length > 0) {
      query = query.contains('tags', tagList);
    }
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch content items: ${error.message}`);
  }

  return (data || []).map((row) => formatContentItem(row as unknown as Record<string, unknown>));
}

/**
 * Retrieves only unscheduled ideas (status = 'idea' and scheduled_at IS NULL)
 * for the workspace's Idea Inbox.
 */
export async function getIdeaInboxItems(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<ContentItemWithMeta[]> {
  return getContentItems(supabase, workspaceId, { is_idea: true });
}

/**
 * Retrieves all unscheduled content items (both ideas and unscheduled drafts)
 * where scheduled_at IS NULL, for the calendar backlog / unscheduled drawer.
 */
export async function getUnscheduledContentItems(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<ContentItemWithMeta[]> {
  return getContentItems(supabase, workspaceId, { is_scheduled: false });
}

/**
 * Retrieves a single content item by ID, strictly enforcing workspace boundary.
 * Returns null if not found or if the item belongs to another workspace.
 */
export async function getContentItemById(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  contentId: string
): Promise<ContentItemWithMeta | null> {
  const { data, error } = await supabase
    .from('content_items')
    .select(CONTENT_SELECT_FIELDS)
    .eq('workspace_id', workspaceId)
    .eq('id', contentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return formatContentItem(data as unknown as Record<string, unknown>);
}

/**
 * Validates that all foreign key references belong strictly to the target workspace.
 * Prevents cross-workspace data contamination, particularly when running under
 * privileged server-side clients that bypass database Row Level Security.
 */
async function validateContentForeignKeys(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  keys: {
    projectId?: string | null;
    milestoneId?: string | null;
    socialAccountId?: string | null;
    recurrenceRuleId?: string | null;
  }
): Promise<void> {
  if (keys.projectId) {
    const { data: proj, error: projErr } = await supabase
      .from('projects')
      .select('id')
      .eq('id', keys.projectId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (projErr || !proj) {
      throw new Error(
        `Cross-workspace reference rejected: project ${keys.projectId} does not belong to workspace ${workspaceId}`
      );
    }
  }

  if (keys.milestoneId) {
    const { data: mile, error: mileErr } = await supabase
      .from('milestones')
      .select('id, project_id')
      .eq('id', keys.milestoneId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (mileErr || !mile) {
      throw new Error(
        `Cross-workspace reference rejected: milestone ${keys.milestoneId} does not belong to workspace ${workspaceId}`
      );
    }
    if (keys.projectId && mile.project_id && mile.project_id !== keys.projectId) {
      throw new Error(
        `Invalid milestone reference: milestone ${keys.milestoneId} does not belong to project ${keys.projectId}`
      );
    }
  }

  if (keys.socialAccountId) {
    const { data: sa, error: saErr } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('id', keys.socialAccountId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (saErr || !sa) {
      throw new Error(
        `Cross-workspace reference rejected: social account ${keys.socialAccountId} does not belong to workspace ${workspaceId}`
      );
    }
  }

  if (keys.recurrenceRuleId) {
    const { data: rule, error: ruleErr } = await supabase
      .from('recurrence_rules')
      .select('id')
      .eq('id', keys.recurrenceRuleId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (ruleErr || !rule) {
      throw new Error(
        `Cross-workspace reference rejected: recurrence rule ${keys.recurrenceRuleId} does not belong to workspace ${workspaceId}`
      );
    }
  }
}

/**
 * Creates a new content item with schema validation. Sets workspace and creator
 * ownership from trusted arguments rather than client-supplied payload properties.
 */
export async function createContentItem(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  input: CreateContentInput,
  userId?: string
): Promise<ContentItemWithMeta> {
  const validated = createContentSchema.parse(input);

  // Authorize foreign keys against workspace
  await validateContentForeignKeys(supabase, workspaceId, {
    projectId: validated.project_id,
    milestoneId: validated.milestone_id,
    socialAccountId: validated.social_account_id,
    recurrenceRuleId: validated.recurrence_rule_id,
  });

  let recurrenceRuleId: string | null = validated.recurrence_rule_id || null;
  let newlyProvisionedRecurrenceRuleId: string | null = null;

  // Provision recurrence rule if embedded specification provided
  if (validated.recurrence) {
    const { data: rule, error: ruleErr } = await supabase
      .from('recurrence_rules')
      .insert({
        workspace_id: workspaceId,
        frequency: validated.recurrence.frequency,
        interval: validated.recurrence.interval,
        by_weekday: validated.recurrence.by_weekday || null,
        by_monthday: validated.recurrence.by_monthday || null,
        until_date: validated.recurrence.until_date || null,
        count: validated.recurrence.count || null,
        timezone: validated.recurrence.timezone,
      })
      .select('id')
      .single();

    if (ruleErr) {
      throw new Error(`Failed to create recurrence rule for content: ${ruleErr.message}`);
    }
    recurrenceRuleId = rule.id;
    newlyProvisionedRecurrenceRuleId = rule.id;
  }

  const { data: item, error } = await supabase
    .from('content_items')
    .insert({
      workspace_id: workspaceId,
      social_account_id: validated.social_account_id || null,
      platform: validated.platform,
      action_type: validated.action_type,
      status: validated.status,
      title: validated.title || null,
      body: validated.body,
      scheduled_at: validated.scheduled_at || null,
      duration_minutes: validated.duration_minutes || null,
      media_urls: validated.media_urls as unknown as Json,
      external_links: validated.external_links as unknown as Json,
      target_reference: (validated.target_reference as unknown as Json) || null,
      tags: validated.tags,
      notes: validated.notes || null,
      project_id: validated.project_id || null,
      milestone_id: validated.milestone_id || null,
      recurrence_rule_id: recurrenceRuleId,
      created_by: userId || null,
    })
    .select(CONTENT_SELECT_FIELDS)
    .single();

  if (error || !item) {
    // If a recurrence rule was provisioned during this call, clean it up to prevent orphan records
    if (newlyProvisionedRecurrenceRuleId) {
      await supabase
        .from('recurrence_rules')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('id', newlyProvisionedRecurrenceRuleId);
    }
    throw new Error(`Failed to create content item: ${error?.message}`);
  }

  return formatContentItem(item as unknown as Record<string, unknown>);
}

/**
 * Updates an existing content item with partial update support.
 * Distinguishes omitted properties (preserved) from explicit null (cleared in database).
 * Immutable columns (id, workspace_id, created_at, created_by) cannot be overwritten.
 */
export async function updateContentItem(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  contentId: string,
  input: UpdateContentInput
): Promise<ContentItemWithMeta> {
  const validated = updateContentSchema.parse(input);

  // Authorize foreign keys against workspace
  await validateContentForeignKeys(supabase, workspaceId, {
    projectId: validated.project_id,
    milestoneId: validated.milestone_id,
    socialAccountId: validated.social_account_id,
    recurrenceRuleId: validated.recurrence_rule_id,
  });

  const updates: Database['public']['Tables']['content_items']['Update'] = {};

  if (validated.platform !== undefined) updates.platform = validated.platform;
  if (validated.action_type !== undefined) updates.action_type = validated.action_type;
  if (validated.status !== undefined) updates.status = validated.status;
  if (validated.title !== undefined) updates.title = validated.title;
  if (validated.body !== undefined) updates.body = validated.body;
  if (validated.scheduled_at !== undefined) updates.scheduled_at = validated.scheduled_at;
  if (validated.duration_minutes !== undefined) updates.duration_minutes = validated.duration_minutes;
  if (validated.media_urls !== undefined) updates.media_urls = validated.media_urls as unknown as Json;
  if (validated.external_links !== undefined) updates.external_links = validated.external_links as unknown as Json;
  if (validated.target_reference !== undefined) updates.target_reference = (validated.target_reference as unknown as Json) || null;
  if (validated.tags !== undefined) updates.tags = validated.tags;
  if (validated.notes !== undefined) updates.notes = validated.notes;
  if (validated.social_account_id !== undefined) updates.social_account_id = validated.social_account_id;
  if (validated.project_id !== undefined) updates.project_id = validated.project_id;
  if (validated.milestone_id !== undefined) updates.milestone_id = validated.milestone_id;
  if (validated.recurrence_rule_id !== undefined) updates.recurrence_rule_id = validated.recurrence_rule_id;

  const { data: updated, error } = await supabase
    .from('content_items')
    .update(updates)
    .eq('workspace_id', workspaceId)
    .eq('id', contentId)
    .select(CONTENT_SELECT_FIELDS)
    .single();

  if (error || !updated) {
    throw new Error(`Failed to update content item: ${error?.message}`);
  }

  return formatContentItem(updated as unknown as Record<string, unknown>);
}

/**
 * Deletes a content item, strictly scoped to workspace ID and content ID.
 */
export async function deleteContentItem(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  contentId: string
): Promise<void> {
  const { error } = await supabase
    .from('content_items')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', contentId);

  if (error) {
    throw new Error(`Failed to delete content item: ${error.message}`);
  }
}

/**
 * Retrieves all social platform account handles configured for a workspace.
 */
export async function getSocialAccounts(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<SocialAccountRow[]> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('platform', { ascending: true })
    .order('account_handle', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch social accounts: ${error.message}`);
  }

  return data || [];
}

/**
 * Creates a social account handle within a workspace with validation.
 */
export async function createSocialAccount(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  input: CreateSocialAccountInput
): Promise<SocialAccountRow> {
  const validated = createSocialAccountSchema.parse(input);

  const { data, error } = await supabase
    .from('social_accounts')
    .insert({
      workspace_id: workspaceId,
      platform: validated.platform,
      account_handle: validated.account_handle,
      account_name: validated.account_name || null,
      avatar_url: validated.avatar_url || null,
      status: validated.status,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create social account: ${error?.message}`);
  }

  return data;
}
