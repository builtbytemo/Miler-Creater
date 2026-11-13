import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from '../src/app/page';
import { LandingShowcase } from '../src/components/marketing/LandingShowcase';

vi.mock('next/server', () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  })),
}));

describe('Marketing Landing Page & Showcase UI (Stage F)', () => {
  it('renders Zahi public landing page with semantic tokens, interactive showcase, and zero legacy branding', async () => {
    const element = await HomePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Zahi');
    expect(html).toContain('Unified Content &amp; Task Command Center');
    expect(html).toContain('Open Zahi');
    expect(html).toContain('Sign In to Existing Workspace');
    expect(html).toContain('Operational Workflows');
    expect(html).toContain('Hierarchical Tasks');
    expect(html).toContain('Unified Calendar');
    expect(html).toContain('Content Pipeline');
    expect(html).toContain('AI Security Boundary');
    expect(html).toContain('zahi-khatam-accent');
    expect(html).not.toMatch(/neutral-\d{3}|bg-blue-(500|600)/);
    expect(html).not.toMatch(/\bmiler\b/i);
  });

  it('renders interactive LandingShowcase with accessible tablist and all 4 workflow views', () => {
    const html = renderToStaticMarkup(<LandingShowcase />);

    expect(html).toContain('role="tablist"');
    expect(html).toContain('Tasks');
    expect(html).toContain('Calendar');
    expect(html).toContain('Content');
    expect(html).toContain('CLI &amp; MCP');
    expect(html).toContain('Priority Queue');
    expect(html).toContain('Sample Studio Workspace');
    expect(html).toContain('Interactive Demo · Sample Data');
    expect(html).toContain('Sample preview data');
    expect(html).not.toMatch(/neutral-\d{3}|bg-blue-(500|600)/);
    expect(html).not.toMatch(/\bmiler\b/i);
  });
});
