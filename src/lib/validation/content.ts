import { z } from 'zod';
import { recurrenceInputSchema } from '@/lib/validation/task';

/**
 * Enums matching public database CHECK constraints and TypeScript types
 */
export const socialPlatformEnum = z.enum(['linkedin', 'reddit', 'threads', 'x']);
export const contentActionTypeEnum = z.enum([
  'post',
  'comment',
  'reply',
  'share',
  'repost',
  'reaction',
]);
export const contentStatusEnum = z.enum([
  'idea',
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'archived',
]);
export const socialAccountStatusEnum = z.enum(['draft', 'connected', 'disconnected']);

export const SUPPORTED_SOCIAL_PLATFORMS = socialPlatformEnum.options;
export const SUPPORTED_CONTENT_ACTION_TYPES = contentActionTypeEnum.options;
export const SUPPORTED_CONTENT_STATUSES = contentStatusEnum.options;

/**
 * Structured target reference schema for comments, replies, reposts, and reactions.
 * Encapsulates platform-specific target identifiers (e.g. tweet ID, subreddit, target post URL).
 */
export const targetReferenceSchema = z
  .object({
    url: z.string().url('Invalid target post URL').optional().nullable(),
    post_id: z.string().trim().min(1, 'Post ID cannot be empty').max(255).optional().nullable(),
    author_handle: z.string().trim().min(1).max(255).optional().nullable(),
    subreddit: z.string().trim().min(1).max(100).optional().nullable(),
    thread_id: z.string().trim().min(1).max(255).optional().nullable(),
  })
  .passthrough();

/**
 * Media item schema: URL string or media descriptor object with alt text.
 */
export const mediaItemSchema = z.union([
  z.string().url('Invalid media URL'),
  z.object({
    url: z.string().url('Invalid media URL'),
    alt: z.string().trim().max(255).optional(),
    type: z.string().trim().max(50).optional(),
  }),
]);

/**
 * External link schema: URL string or link object with label.
 */
export const externalLinkItemSchema = z.union([
  z.string().url('Invalid external link URL'),
  z.object({
    url: z.string().url('Invalid external link URL'),
    title: z.string().trim().max(255).optional(),
  }),
]);

/**
 * Schema for creating a new social content item.
 * Supports unscheduled ideas (scheduled_at = null/omitted) and scheduled items.
 * Allows long content bodies without arbitrary client-side length truncations.
 */
export const createContentSchema = z
  .object({
    platform: socialPlatformEnum,
    action_type: contentActionTypeEnum.default('post'),
    status: contentStatusEnum.default('idea'),
    title: z.string().trim().max(255, 'Title is too long').optional().nullable(),
    body: z.string().default(''),
    scheduled_at: z
      .string()
      .datetime({ message: 'Invalid scheduled datetime format (must be ISO 8601)' })
      .optional()
      .nullable(),
    duration_minutes: z
      .number()
      .int('Duration must be an integer')
      .min(1, 'Duration must be at least 1 minute')
      .max(10080, 'Duration cannot exceed 7 days (10080 minutes)')
      .optional()
      .nullable(),
    media_urls: z.array(mediaItemSchema).default([]),
    external_links: z.array(externalLinkItemSchema).default([]),
    target_reference: targetReferenceSchema.optional().nullable(),
    tags: z.array(z.string().trim().min(1, 'Tag cannot be empty').max(50, 'Tag is too long')).default([]),
    notes: z.string().trim().max(10000, 'Notes are too long').optional().nullable(),
    social_account_id: z.string().uuid('Invalid social account ID').optional().nullable(),
    project_id: z.string().uuid('Invalid project ID').optional().nullable(),
    milestone_id: z.string().uuid('Invalid milestone ID').optional().nullable(),
    recurrence_rule_id: z.string().uuid('Invalid recurrence rule ID').optional().nullable(),
    recurrence: recurrenceInputSchema.optional().nullable(),
  })
  .refine(
    (data) => {
      const hasTitle = typeof data.title === 'string' && data.title.trim().length > 0;
      const hasBody = typeof data.body === 'string' && data.body.trim().length > 0;
      return hasTitle || hasBody;
    },
    {
      message: 'Content item must include either a title or a body',
      path: ['body'],
    }
  );

/**
 * Schema for updating an existing social content item.
 * Supports partial updates. Omitted fields are not overwritten.
 * Explicit null values are permitted only for nullable database columns.
 */
export const updateContentSchema = z.object({
  platform: socialPlatformEnum.optional(),
  action_type: contentActionTypeEnum.optional(),
  status: contentStatusEnum.optional(),
  title: z.string().trim().max(255, 'Title is too long').optional().nullable(),
  body: z.string().optional(),
  scheduled_at: z
    .string()
    .datetime({ message: 'Invalid scheduled datetime format (must be ISO 8601)' })
    .optional()
    .nullable(),
  duration_minutes: z
    .number()
    .int('Duration must be an integer')
    .min(1, 'Duration must be at least 1 minute')
    .max(10080, 'Duration cannot exceed 7 days (10080 minutes)')
    .optional()
    .nullable(),
  media_urls: z.array(mediaItemSchema).optional(),
  external_links: z.array(externalLinkItemSchema).optional(),
  target_reference: targetReferenceSchema.optional().nullable(),
  tags: z.array(z.string().trim().min(1, 'Tag cannot be empty').max(50, 'Tag is too long')).optional(),
  notes: z.string().trim().max(10000, 'Notes are too long').optional().nullable(),
  social_account_id: z.string().uuid('Invalid social account ID').optional().nullable(),
  project_id: z.string().uuid('Invalid project ID').optional().nullable(),
  milestone_id: z.string().uuid('Invalid milestone ID').optional().nullable(),
  recurrence_rule_id: z.string().uuid('Invalid recurrence rule ID').optional().nullable(),
});

/**
 * Query filter schema for retrieving content items.
 * Validates enum filters and temporal ranges without introducing unwanted defaults.
 */
export const contentFilterSchema = z
  .object({
    platform: z.union([socialPlatformEnum, z.array(socialPlatformEnum)]).optional(),
    status: z.union([contentStatusEnum, z.array(contentStatusEnum)]).optional(),
    action_type: z.union([contentActionTypeEnum, z.array(contentActionTypeEnum)]).optional(),
    project_id: z.string().uuid('Invalid project ID').optional(),
    social_account_id: z.string().uuid('Invalid social account ID').optional(),
    is_idea: z.boolean().optional(),
    is_scheduled: z.boolean().optional(),
    scheduled_from: z.string().datetime({ message: 'Invalid start datetime format' }).optional(),
    scheduled_to: z.string().datetime({ message: 'Invalid end datetime format' }).optional(),
    search: z.string().optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .refine(
    (data) => {
      if (data.scheduled_from && data.scheduled_to) {
        return new Date(data.scheduled_to).getTime() >= new Date(data.scheduled_from).getTime();
      }
      return true;
    },
    {
      message: 'scheduled_to cannot be earlier than scheduled_from',
      path: ['scheduled_to'],
    }
  );

/**
 * Social account creation schema for workspace handle configuration.
 */
export const createSocialAccountSchema = z.object({
  platform: socialPlatformEnum,
  account_handle: z.string().trim().min(1, 'Account handle is required').max(100),
  account_name: z.string().trim().max(100).optional().nullable(),
  avatar_url: z.string().url('Invalid avatar URL').optional().nullable(),
  status: socialAccountStatusEnum.default('draft'),
});

export type CreateContentInput = z.input<typeof createContentSchema>;
export type CreateContentOutput = z.output<typeof createContentSchema>;
export type UpdateContentInput = z.input<typeof updateContentSchema>;
export type ContentFilterInput = z.input<typeof contentFilterSchema>;
export type TargetReferenceInput = z.input<typeof targetReferenceSchema>;
export type CreateSocialAccountInput = z.input<typeof createSocialAccountSchema>;
