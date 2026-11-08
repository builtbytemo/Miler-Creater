import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), client: vi.fn(), workspace: vi.fn(), list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }));
vi.mock('@/lib/auth/workspace', () => ({ resolveAuthorizedWorkspace: mocks.workspace }));
vi.mock('@/lib/mcp/token-service', () => ({ listWorkspaceTokens: mocks.list, createAiToken: mocks.create, revokeAiToken: mocks.revoke }));
import { POST } from '@/app/api/cli/tokens/route';

const userId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const request = (body: unknown, token = 'user-session') => new Request('https://example.com/api/cli/tokens', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-key';
  mocks.client.mockReturnValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.workspace.mockResolvedValue({ workspaceId });
});

describe('CLI token management', () => {
  it('rejects unverified credentials before any token operation', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    expect((await POST(request({ action: 'list' }, 'ai-token'))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('enforces workspace membership before calling the service', async () => {
    mocks.workspace.mockResolvedValue({ error: 'denied' });
    expect((await POST(request({ action: 'list', workspaceId }))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('uses the verified identity and service for creation', async () => {
    mocks.create.mockResolvedValue({ token: 'once' });
    const res = await POST(request({ action: 'create', input: { name: 'CLI', scopes: ['task:read'] } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspaceId, userId, name: 'CLI', scopes: ['task:read'] }));
  });
  it('rejects unknown fields and does not expose service errors', async () => {
    expect((await POST(request({ action: 'list', userId }))).status).toBe(400);
    mocks.list.mockRejectedValue(new Error('secret database error'));
    const res = await POST(request({ action: 'list' }));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('secret');
  });
});
