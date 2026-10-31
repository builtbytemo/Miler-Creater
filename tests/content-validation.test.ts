import { describe, it, expect } from 'vitest';
import {
  createContentSchema,
  updateContentSchema,
  contentFilterSchema,
  targetReferenceSchema,
  createSocialAccountSchema,
  socialPlatformEnum,
  contentActionTypeEnum,
  contentStatusEnum,
  SUPPORTED_SOCIAL_PLATFORMS,
  SUPPORTED_CONTENT_ACTION_TYPES,
  SUPPORTED_CONTENT_STATUSES,
} from '../src/lib/validation/content';

describe('Content Engine Input Validation (Zod Schemas)', () => {
  describe('Constants and Enums', () => {
    it('defines exactly the 4 database-supported social platforms', () => {
      expect(SUPPORTED_SOCIAL_PLATFORMS).toEqual(['linkedin', 'reddit', 'threads', 'x']);
      expect(socialPlatformEnum.safeParse('linkedin').success).toBe(true);
      expect(socialPlatformEnum.safeParse('reddit').success).toBe(true);
      expect(socialPlatformEnum.safeParse('threads').success).toBe(true);
      expect(socialPlatformEnum.safeParse('x').success).toBe(true);
      expect(socialPlatformEnum.safeParse('twitter').success).toBe(false);
      expect(socialPlatformEnum.safeParse('facebook').success).toBe(false);
    });

    it('defines exactly the 6 database-supported content action types', () => {
      expect(SUPPORTED_CONTENT_ACTION_TYPES).toEqual([
        'post',
        'comment',
        'reply',
        'share',
        'repost',
        'reaction',
      ]);
      expect(contentActionTypeEnum.safeParse('post').success).toBe(true);
      expect(contentActionTypeEnum.safeParse('reaction').success).toBe(true);
      expect(contentActionTypeEnum.safeParse('retweet').success).toBe(false);
      expect(contentActionTypeEnum.safeParse('like').success).toBe(false);
    });

    it('defines exactly the 7 database-supported content statuses', () => {
      expect(SUPPORTED_CONTENT_STATUSES).toEqual([
        'idea',
        'draft',
        'scheduled',
        'publishing',
        'published',
        'failed',
        'archived',
      ]);
    });
  });

  describe('createContentSchema', () => {
    it('accepts valid minimal content input with title only (unscheduled idea)', () => {
      const result = createContentSchema.safeParse({
        platform: 'x',
        title: 'Exploring AI Agent Tooling in 2026',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.platform).toBe('x');
        expect(result.data.title).toBe('Exploring AI Agent Tooling in 2026');
        expect(result.data.body).toBe('');
        expect(result.data.action_type).toBe('post');
        expect(result.data.status).toBe('idea');
        expect(result.data.scheduled_at).toBeUndefined();
        expect(result.data.media_urls).toEqual([]);
        expect(result.data.external_links).toEqual([]);
        expect(result.data.tags).toEqual([]);
      }
    });

    it('accepts valid minimal content input with body only (no title required for short posts)', () => {
      const result = createContentSchema.safeParse({
        platform: 'threads',
        body: 'Quick thought: agentic workflows need tight feedback loops.',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.platform).toBe('threads');
        expect(result.data.body).toBe('Quick thought: agentic workflows need tight feedback loops.');
        expect(result.data.title).toBeUndefined();
        expect(result.data.action_type).toBe('post');
        expect(result.data.status).toBe('idea');
      }
    });

    it('accepts full payload for all supported platforms and action types', () => {
      const platforms = ['linkedin', 'reddit', 'threads', 'x'] as const;
      const actionTypes = ['post', 'comment', 'reply', 'share', 'repost', 'reaction'] as const;

      for (const platform of platforms) {
        for (const action_type of actionTypes) {
          const result = createContentSchema.safeParse({
            platform,
            action_type,
            status: 'draft',
            title: `${platform} ${action_type} draft`,
            body: 'Detailed body content text for this item.',
            scheduled_at: '2026-11-15T14:00:00Z',
            duration_minutes: 45,
            media_urls: ['https://cdn.example.com/asset1.png'],
            external_links: ['https://example.com/blog'],
            tags: ['dev', 'ai'],
            notes: 'Internal editorial note',
          });
          expect(result.success).toBe(true);
        }
      }
    });

    it('permits long content bodies without arbitrary platform-specific truncation', () => {
      // 5,000-character long draft (exceeding typical X limits, valid as planning/draft content)
      const longBody = 'A'.repeat(5000);
      const result = createContentSchema.safeParse({
        platform: 'x',
        title: 'Long Thread Draft',
        body: longBody,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body.length).toBe(5000);
      }
    });

    it('rejects input with neither title nor body provided', () => {
      const result = createContentSchema.safeParse({
        platform: 'x',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/must include either a title or a body/);
      }

      const emptyWhitespaceResult = createContentSchema.safeParse({
        platform: 'linkedin',
        title: '   ',
        body: '   ',
      });
      expect(emptyWhitespaceResult.success).toBe(false);
    });

    it('rejects invalid platform values', () => {
      const result = createContentSchema.safeParse({
        platform: 'instagram' as unknown as 'x',
        title: 'Instagram post',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid action_type values', () => {
      const result = createContentSchema.safeParse({
        platform: 'x',
        action_type: 'retweet' as unknown as 'post',
        title: 'Post title',
      });
      expect(result.success).toBe(false);
    });

    it('accepts explicit null for permitted nullable fields', () => {
      const result = createContentSchema.safeParse({
        platform: 'reddit',
        title: 'Ask Reddit: What is your favorite developer tool?',
        body: '',
        scheduled_at: null,
        duration_minutes: null,
        target_reference: null,
        notes: null,
        project_id: null,
        milestone_id: null,
        recurrence_rule_id: null,
        social_account_id: null,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scheduled_at).toBeNull();
        expect(result.data.duration_minutes).toBeNull();
        expect(result.data.target_reference).toBeNull();
        expect(result.data.notes).toBeNull();
      }
    });

    it('rejects explicit null for non-nullable database fields', () => {
      // body is NOT NULL in database
      expect(
        createContentSchema.safeParse({
          platform: 'x',
          title: 'Post title',
          body: null,
        }).success
      ).toBe(false);

      // platform is NOT NULL
      expect(
        createContentSchema.safeParse({
          platform: null,
          title: 'Post title',
        }).success
      ).toBe(false);

      // tags is NOT NULL
      expect(
        createContentSchema.safeParse({
          platform: 'x',
          title: 'Post title',
          tags: null,
        }).success
      ).toBe(false);

      // media_urls is NOT NULL
      expect(
        createContentSchema.safeParse({
          platform: 'x',
          title: 'Post title',
          media_urls: null,
        }).success
      ).toBe(false);

      // external_links is NOT NULL
      expect(
        createContentSchema.safeParse({
          platform: 'x',
          title: 'Post title',
          external_links: null,
        }).success
      ).toBe(false);
    });

    it('validates scheduled_at requires a valid ISO 8601 datetime', () => {
      const valid = createContentSchema.safeParse({
        platform: 'x',
        body: 'Scheduled tweet',
        scheduled_at: '2026-11-20T10:30:00.000Z',
      });
      expect(valid.success).toBe(true);

      const invalidDate = createContentSchema.safeParse({
        platform: 'x',
        body: 'Scheduled tweet',
        scheduled_at: 'tomorrow-at-10am',
      });
      expect(invalidDate.success).toBe(false);
    });

    it('validates structured target_reference object', () => {
      const validTarget = createContentSchema.safeParse({
        platform: 'x',
        action_type: 'reply',
        body: 'Great insight on distributed systems!',
        target_reference: {
          url: 'https://x.com/architect/status/987654321',
          post_id: '987654321',
          author_handle: '@architect',
          subreddit: null,
        },
      });
      expect(validTarget.success).toBe(true);

      // Malformed URL in target_reference
      const invalidUrlTarget = createContentSchema.safeParse({
        platform: 'x',
        action_type: 'reply',
        body: 'Replying here',
        target_reference: {
          url: 'not-a-valid-url',
        },
      });
      expect(invalidUrlTarget.success).toBe(false);

      // Primitive target_reference rejected
      const primitiveTarget = createContentSchema.safeParse({
        platform: 'x',
        action_type: 'reply',
        body: 'Replying here',
        target_reference: 'some-target-id' as unknown as object,
      });
      expect(primitiveTarget.success).toBe(false);
    });

    it('validates media_urls and external_links structures', () => {
      // Valid string URLs
      const validStrings = createContentSchema.safeParse({
        platform: 'linkedin',
        title: 'Launch post',
        media_urls: ['https://cdn.example.com/slide1.png', 'https://cdn.example.com/slide2.png'],
        external_links: ['https://example.com/announcement'],
      });
      expect(validStrings.success).toBe(true);

      // Valid structured link objects
      const validObjects = createContentSchema.safeParse({
        platform: 'linkedin',
        title: 'Launch post',
        media_urls: [{ url: 'https://cdn.example.com/hero.jpg', alt: 'Hero banner', type: 'image/jpeg' }],
        external_links: [{ url: 'https://example.com/whitepaper', title: 'Whitepaper PDF' }],
      });
      expect(validObjects.success).toBe(true);

      // Malformed URL in media_urls
      const badMedia = createContentSchema.safeParse({
        platform: 'linkedin',
        title: 'Launch post',
        media_urls: ['not-an-url'],
      });
      expect(badMedia.success).toBe(false);

      // Non-array media_urls rejected
      const nonArrayMedia = createContentSchema.safeParse({
        platform: 'linkedin',
        title: 'Launch post',
        media_urls: 'https://cdn.example.com/hero.jpg' as unknown as string[],
      });
      expect(nonArrayMedia.success).toBe(false);
    });

    it('validates UUID foreign key references', () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      const valid = createContentSchema.safeParse({
        platform: 'reddit',
        title: 'Project Update',
        project_id: validUuid,
        milestone_id: validUuid,
        social_account_id: validUuid,
        recurrence_rule_id: validUuid,
      });
      expect(valid.success).toBe(true);

      const invalid = createContentSchema.safeParse({
        platform: 'reddit',
        title: 'Project Update',
        project_id: 'invalid-uuid-string',
      });
      expect(invalid.success).toBe(false);
    });

    it('accepts embedded recurrence input for regular publishing cadences', () => {
      const result = createContentSchema.safeParse({
        platform: 'linkedin',
        title: 'Weekly Tech Tip',
        body: 'Here is this week tip on systems architecture...',
        scheduled_at: '2026-11-02T09:00:00Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          by_weekday: [1], // Monday
          timezone: 'Asia/Cairo',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('updateContentSchema', () => {
    it('accepts an empty update object without injecting unexpected fields', () => {
      const result = updateContentSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data).length).toBe(0);
      }
    });

    it('accepts partial updates to status and scheduled_at', () => {
      const result = updateContentSchema.safeParse({
        status: 'scheduled',
        scheduled_at: '2026-11-25T16:00:00Z',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('scheduled');
        expect(result.data.scheduled_at).toBe('2026-11-25T16:00:00Z');
        expect(result.data.title).toBeUndefined();
        expect(result.data.body).toBeUndefined();
      }
    });

    it('permits unscheduling an item back to the Idea Inbox by setting scheduled_at to null', () => {
      const result = updateContentSchema.safeParse({
        status: 'idea',
        scheduled_at: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scheduled_at).toBeNull();
        expect(result.data.status).toBe('idea');
      }
    });

    it('rejects explicit null for non-nullable database columns on update', () => {
      expect(updateContentSchema.safeParse({ platform: null }).success).toBe(false);
      expect(updateContentSchema.safeParse({ action_type: null }).success).toBe(false);
      expect(updateContentSchema.safeParse({ status: null }).success).toBe(false);
      expect(updateContentSchema.safeParse({ body: null }).success).toBe(false);
      expect(updateContentSchema.safeParse({ tags: null }).success).toBe(false);
      expect(updateContentSchema.safeParse({ media_urls: null }).success).toBe(false);
      expect(updateContentSchema.safeParse({ external_links: null }).success).toBe(false);
    });

    it('permits explicit null for nullable columns on update', () => {
      const result = updateContentSchema.safeParse({
        title: null,
        notes: null,
        duration_minutes: null,
        target_reference: null,
        social_account_id: null,
        project_id: null,
        milestone_id: null,
        recurrence_rule_id: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBeNull();
        expect(result.data.notes).toBeNull();
        expect(result.data.duration_minutes).toBeNull();
        expect(result.data.target_reference).toBeNull();
      }
    });

    it('rejects malformed target_reference on update', () => {
      const result = updateContentSchema.safeParse({
        target_reference: { url: 'bad-url' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('contentFilterSchema', () => {
    it('accepts empty filter payload without injecting unintended defaults', () => {
      const result = contentFilterSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data).length).toBe(0);
      }
    });

    it('accepts single platform or array of platforms', () => {
      expect(contentFilterSchema.safeParse({ platform: 'x' }).success).toBe(true);
      const multi = contentFilterSchema.safeParse({ platform: ['x', 'threads', 'linkedin'] });
      expect(multi.success).toBe(true);
      if (multi.success) {
        expect(multi.data.platform).toEqual(['x', 'threads', 'linkedin']);
      }
    });

    it('accepts single status or array of statuses', () => {
      expect(contentFilterSchema.safeParse({ status: 'idea' }).success).toBe(true);
      expect(contentFilterSchema.safeParse({ status: ['idea', 'draft'] }).success).toBe(true);
    });

    it('accepts single action_type or array of action types', () => {
      expect(contentFilterSchema.safeParse({ action_type: 'post' }).success).toBe(true);
      expect(contentFilterSchema.safeParse({ action_type: ['post', 'comment'] }).success).toBe(true);
    });

    it('accepts is_idea boolean filter for Idea Inbox querying', () => {
      const ideaFilter = contentFilterSchema.safeParse({ is_idea: true });
      expect(ideaFilter.success).toBe(true);
      if (ideaFilter.success) {
        expect(ideaFilter.data.is_idea).toBe(true);
      }
    });

    it('validates scheduled datetime window in chronological order', () => {
      const validWindow = contentFilterSchema.safeParse({
        scheduled_from: '2026-11-01T00:00:00Z',
        scheduled_to: '2026-11-30T23:59:59Z',
      });
      expect(validWindow.success).toBe(true);

      // Inverted window: to < from
      const invertedWindow = contentFilterSchema.safeParse({
        scheduled_from: '2026-11-30T00:00:00Z',
        scheduled_to: '2026-11-01T00:00:00Z',
      });
      expect(invertedWindow.success).toBe(false);
      if (!invertedWindow.success) {
        expect(invertedWindow.error.issues[0]?.message).toMatch(
          /scheduled_to cannot be earlier than scheduled_from/
        );
      }
    });

    it('rejects invalid enum values in filters', () => {
      expect(contentFilterSchema.safeParse({ platform: 'tiktok' as unknown as 'x' }).success).toBe(false);
      expect(contentFilterSchema.safeParse({ status: 'unknown' as unknown as 'idea' }).success).toBe(false);
      expect(contentFilterSchema.safeParse({ action_type: 'pin' as unknown as 'post' }).success).toBe(false);
    });

    it('validates UUID filter parameters', () => {
      const validUuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      expect(contentFilterSchema.safeParse({ project_id: validUuid }).success).toBe(true);
      expect(contentFilterSchema.safeParse({ social_account_id: validUuid }).success).toBe(true);
      expect(contentFilterSchema.safeParse({ project_id: 'bad-uuid' }).success).toBe(false);
    });
  });

  describe('createSocialAccountSchema', () => {
    it('accepts valid social account handle configuration', () => {
      const result = createSocialAccountSchema.safeParse({
        platform: 'x',
        account_handle: '@milerdev',
        account_name: 'Miler Developer',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('draft');
      }
    });

    it('rejects empty account handle', () => {
      const result = createSocialAccountSchema.safeParse({
        platform: 'linkedin',
        account_handle: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid platform for social account', () => {
      const result = createSocialAccountSchema.safeParse({
        platform: 'youtube' as unknown as 'x',
        account_handle: '@milerdev',
      });
      expect(result.success).toBe(false);
    });
  });
});
