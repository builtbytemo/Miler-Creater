import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentWorkspace } from '../src/components/content/ContentWorkspace';
import type { ContentItemWithMeta } from '../src/lib/services/content-service';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/content',
}));

vi.mock('@/lib/actions/content-actions', () => ({
  deleteContentItemAction: vi.fn(),
  updateContentItemAction: vi.fn(),
  createContentItemAction: vi.fn(),
  createSocialAccountAction: vi.fn(),
}));

const makeContent = (overrides: Partial<ContentItemWithMeta> = {}): ContentItemWithMeta =>
  ({
    id: 'c1',
    workspace_id: 'w1',
    social_account_id: null,
    platform: 'x',
    action_type: 'post',
    status: 'scheduled',
    title: 'Sample',
    body: 'Body',
    scheduled_at: null,
    duration_minutes: null,
    media_urls: [],
    external_links: [],
    target_reference: null,
    tags: [],
    notes: null,
    project_id: null,
    milestone_id: null,
    recurrence_rule_id: null,
    created_by: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }) as ContentItemWithMeta;

describe('ContentWorkspace Today vs All toggle & chronological order', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sampleItems: ContentItemWithMeta[] = [
    makeContent({
      id: 'late-today',
      title: 'Late Today Post',
      scheduled_at: '2026-11-05T16:00:00Z',
    }),
    makeContent({
      id: 'early-today',
      title: 'Early Today Post',
      scheduled_at: '2026-11-05T07:00:00Z',
    }),
    makeContent({
      id: 'tomorrow-item',
      title: 'Tomorrow Post',
      scheduled_at: '2026-11-06T09:00:00Z',
    }),
    makeContent({
      id: 'idea-unscheduled',
      status: 'idea',
      title: 'Unscheduled Idea',
      scheduled_at: null,
    }),
  ];

  it('defaults to Today and renders today items in chronological order (earliest first)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContentWorkspace, {
        initialItems: sampleItems,
        initialIdeas: [],
        workspaceId: 'w1',
        socialAccounts: [],
        projects: [],
        userTimeZone: 'Africa/Cairo',
      })
    );

    expect(html).toContain('aria-label="Filter content by date"');
    expect(html).toContain('Early Today Post');
    expect(html).toContain('Late Today Post');
    expect(html).not.toContain('Tomorrow Post');
    expect(html).not.toContain('Unscheduled Idea');

    // Chronological order: Early Today Post appears before Late Today Post
    expect(html.indexOf('Early Today Post')).toBeLessThan(html.indexOf('Late Today Post'));
  });

  it('defaults to All when initialContentId is provided so deep-linked items remain visible', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContentWorkspace, {
        initialItems: sampleItems,
        initialIdeas: [],
        workspaceId: 'w1',
        socialAccounts: [],
        projects: [],
        userTimeZone: 'Africa/Cairo',
        initialContentId: 'tomorrow-item',
      })
    );

    expect(html).toContain('Tomorrow Post');
    expect(html).toContain('Early Today Post');
    expect(html).toContain('Unscheduled Idea');
    expect(html.indexOf('Early Today Post')).toBeLessThan(html.indexOf('Tomorrow Post'));
    expect(html.indexOf('Tomorrow Post')).toBeLessThan(html.indexOf('Unscheduled Idea'));
  });

  it('defaults to All when initialTab is ideas, drafts, or archived', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContentWorkspace, {
        initialItems: sampleItems,
        initialIdeas: [],
        workspaceId: 'w1',
        socialAccounts: [],
        projects: [],
        userTimeZone: 'Africa/Cairo',
        initialTab: 'ideas',
      })
    );

    expect(html).toContain('Unscheduled Idea');
  });
});
