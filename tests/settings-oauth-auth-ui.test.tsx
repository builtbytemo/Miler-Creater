import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const {
  mockRedirect,
  mockConnection,
  mockGetUser,
  mockFrom,
  mockResolveAuthorizedWorkspace,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
  mockConnection: vi.fn().mockResolvedValue(undefined),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockResolveAuthorizedWorkspace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/tokens',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/server', () => ({
  connection: mockConnection,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock('@/lib/auth/workspace', () => ({
  resolveAuthorizedWorkspace: mockResolveAuthorizedWorkspace,
}));

vi.mock('@/lib/actions/ai-token-actions', () => ({
  createAiTokenAction: vi.fn(),
  listWorkspaceTokensAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
  revokeAiTokenAction: vi.fn(),
}));

vi.mock('@/lib/actions/notification-actions', () => ({
  getUnreadNotificationCountAction: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  getNotificationPreferencesAction: vi.fn().mockResolvedValue({ success: true, data: null }),
  updateNotificationPreferencesAction: vi.fn(),
}));

vi.mock('@/lib/actions/daily-briefing-actions', () => ({
  getDailyBriefingStateAction: vi.fn().mockResolvedValue({ error: 'Not loaded in SSR' }),
  updateDailyBriefingPreferencesAction: vi.fn(),
  sendTestBriefingMessageAction: vi.fn(),
  startTelegramConnectionAction: vi.fn(),
  disconnectTelegramAction: vi.fn(),
}));

vi.mock('@/lib/actions/oauth-actions', () => ({
  submitOAuthDecisionAction: vi.fn(),
}));

vi.mock('@/lib/mcp/oauth', () => ({
  validateOAuthAuthorizeParams: vi.fn().mockResolvedValue({
    valid: false,
    errorCode: 'invalid_request',
    errorDescription: 'Missing required client_id parameter.',
    canRedirectToCallback: false,
  }),
}));

import AiTokensSettingsPage from '../src/app/settings/tokens/page';
import OAuthAuthorizePage from '../src/app/oauth/authorize/page';
import AuthLayout from '../src/app/auth/layout';
import { SettingsNav } from '../src/components/settings/SettingsNav';
import { ClaudeConnection } from '../src/components/settings/ClaudeConnection';
import { CliConnection } from '../src/components/settings/CliConnection';
import { DailyBriefingSettings } from '../src/components/settings/DailyBriefingSettings';
import { NotificationPreferencesForm } from '../src/components/notifications/NotificationPreferencesForm';
import { OAuthConsentForm } from '../src/components/oauth/OAuthConsentForm';

describe('Stage E: Settings, OAuth Consent & Auth UI Transformation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zahi.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('renders unified SettingsNav masthead and segmented section links', () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsNav, {
        activeTab: 'tokens',
        backHref: '/dashboard',
        backLabel: 'Back to Overview',
        eyebrow: 'Settings & Integrations',
        title: 'AI & MCP API Tokens',
        description: 'Manage CLI, MCP, and API tokens.',
        metaLabel: 'Zahi HQ · Africa/Cairo',
      })
    );

    expect(html).toContain('Back to Overview');
    expect(html).toContain('/settings/notifications');
    expect(html).toContain('/settings/tokens');
    expect(html).toContain('Notifications &amp; Briefing');
    expect(html).toContain('CLI, MCP &amp; API Tokens');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Zahi HQ · Africa/Cairo');
  });

  it('normalizes invalid timezone in /settings/tokens page cleanly', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-1' } } });
    mockResolveAuthorizedWorkspace.mockResolvedValueOnce({ workspaceId: 'ws-1', error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspaces') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Zahi Studio' } }),
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'Invalid/Zone' } }),
        };
      }
      return {};
    });

    const el = (await AiTokensSettingsPage()) as React.ReactElement;
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Africa/Cairo');
    expect(html).not.toContain('Invalid/Zone');
    expect(html).toContain('Connect the Zahi CLI');
    expect(html).toContain('Connect Claude');
  });

  it('uses Zahi Light+Dark tokens across CliConnection and ClaudeConnection', () => {
    const cliHtml = renderToStaticMarkup(React.createElement(CliConnection, { workspaceId: 'ws-1' }));
    expect(cliHtml).toContain('Connect the Zahi CLI');
    expect(cliHtml).toContain('miler login');
    expect(cliHtml).toContain('surface-card');

    const claudeHtml = renderToStaticMarkup(React.createElement(ClaudeConnection));
    expect(claudeHtml).toContain('Connect Claude');
    expect(claudeHtml).toContain('Remote MCP OAuth 2.1');
    expect(claudeHtml).toContain('Copy URL');
    expect(claudeHtml).toContain('btn-accent');

    const prefsHtml = renderToStaticMarkup(
      React.createElement(NotificationPreferencesForm, { workspaceId: 'ws-1' })
    );
    expect(prefsHtml).toContain('Loading notification preferences...');

    const briefingHtml = renderToStaticMarkup(React.createElement(DailyBriefingSettings));
    expect(briefingHtml).toContain('Loading Daily Briefing settings...');
  });

  it('renders OAuthConsentForm and invalid OAuth error screen with Zahi design tokens', async () => {
    const consentHtml = renderToStaticMarkup(
      React.createElement(OAuthConsentForm, {
        userEmail: 'amira@zahi.local',
        clientId: 'client-1',
        clientName: 'Claude Web',
        redirectUri: 'https://claude.ai/api/mcp/auth_callback',
        responseType: 'code',
        codeChallenge: 'challenge-123',
        codeChallengeMethod: 'S256',
        state: 'state-123',
        requestedScopeRaw: null,
        resource: 'https://app.zahi.example/api/mcp',
        initialScopes: ['task:read', 'content:read'],
        wasScopeOmitted: true,
        workspaces: [{ id: 'ws-1', name: 'Zahi Studio', role: 'owner' }],
      })
    );

    expect(consentHtml).toContain('data-testid="oauth-consent-card"');
    expect(consentHtml).toContain('zahi-khatam-accent');
    expect(consentHtml).toContain('PKCE S256 Verified');
    expect(consentHtml).toContain('Least-privilege default applied');
    expect(consentHtml).toContain('input-control');

    const invalidPage = await OAuthAuthorizePage({
      searchParams: Promise.resolve({}),
    });
    const invalidHtml = renderToStaticMarkup(invalidPage as React.ReactElement);
    expect(invalidHtml).toContain('data-testid="oauth-authorize-error"');
    expect(invalidHtml).toContain('zahi-khatam-accent');
    expect(invalidHtml).toContain('zahi-mascot');
  });

  it('includes Back to Home link and theme toggle in AuthLayout while preserving brand assertions', () => {
    const html = renderToStaticMarkup(
      React.createElement(AuthLayout, null, React.createElement('div', null, 'Form'))
    );
    expect(html).toContain('Back to Home');
    expect(html).toContain('data-testid="theme-toggle-compact"');
    expect(html).toContain('>Zahi<');
  });

  it('removes dark-only legacy color classes from all Stage E settings and OAuth files', () => {
    const filesToAudit = [
      'src/components/settings/SettingsNav.tsx',
      'src/components/settings/ClaudeConnection.tsx',
      'src/components/settings/CliConnection.tsx',
      'src/components/settings/DailyBriefingSettings.tsx',
      'src/components/settings/AiTokensManager.tsx',
      'src/components/notifications/NotificationPreferencesForm.tsx',
      'src/app/oauth/authorize/page.tsx',
      'src/components/oauth/OAuthConsentForm.tsx',
    ];

    for (const relPath of filesToAudit) {
      const content = readFileSync(join(process.cwd(), relPath), 'utf8');
      expect(content, `${relPath} still has neutral-*`).not.toMatch(/\b(bg|text|border)-neutral-/);
      expect(content, `${relPath} still has dark-only blue-600/500`).not.toMatch(/\bbg-blue-(500|600)\b/);
    }
  });
});
