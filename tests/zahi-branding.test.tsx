import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthLayout from '../src/app/auth/layout';
import HomePage from '../src/app/page';
import { CliConnection } from '../src/components/settings/CliConnection';

vi.mock('next/server', () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  })),
}));

vi.mock('@/lib/actions/ai-token-actions', () => ({
  createAiTokenAction: vi.fn(),
}));

describe('Zahi User-Facing Branding Consistency', () => {
  it('uses Zahi product branding on the public landing page while preserving descriptive copy', async () => {
    const element = await HomePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Zahi');
    expect(html).toContain('Open Zahi');
    expect(html).toContain('Unified Content &amp; Task Command Center');
    expect(html).not.toContain('Open Command Center');
    expect(html).not.toMatch(/\bmiler\b/i);
  });

  it('uses Zahi branding in the authentication layout', () => {
    const html = renderToStaticMarkup(
      AuthLayout({ children: <div>Auth form</div> })
    );

    expect(html).toContain('>Zahi<');
    expect(html).toContain('Content &amp; Task Command Center');
    expect(html).not.toContain('>Command Center<');
    expect(html).not.toMatch(/\bmiler\b/i);
  });

  it('uses Zahi CLI headings while preserving the actual miler login command', () => {
    const html = renderToStaticMarkup(<CliConnection workspaceId="ws-1" />);

    expect(html).toContain('Connect the Zahi CLI');
    expect(html).toContain('Zahi CLI');
    expect(html).toContain('miler login');
    expect(html).not.toContain('Connect the Miler CLI');
  });
});
