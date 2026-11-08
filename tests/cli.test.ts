import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), transport: vi.fn(), signIn: vi.fn() }));
vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    connect = mocks.connect;
    close = mocks.close;
    listTools = mocks.listTools;
    callTool = mocks.callTool;
  },
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: unknown) { mocks.transport(url, options); }
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }) }));
import { parseEndpoint, run } from '../cli/miller.mjs';

const env = { ...process.env, MILLER_URL: 'https://example.com', MILLER_TOKEN: 'secret' };
const output = { ...console, log: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
});

describe('CLI', () => {
  it('restricts credential-bearing requests to HTTPS or local HTTP', () => {
    expect(parseEndpoint('http://localhost:3000').href).toBe('http://localhost:3000/api/mcp');
    expect(() => parseEndpoint('http://example.com')).toThrow('HTTPS');
    expect(() => parseEndpoint('https://user:pass@example.com')).toThrow('credentials');
    expect(() => parseEndpoint('https://example.com/?token=secret')).toThrow();
  });

  it('lists every page and describes a discovered action', async () => {
    mocks.listTools.mockResolvedValueOnce({ tools: [{ name: 'first' }], nextCursor: 'next' }).mockResolvedValueOnce({ tools: [{ name: 'second' }] });
    expect(await run(['describe', 'second'], env, output)).toBe(0);
    expect(JSON.parse(output.log.mock.calls[0][0]).name).toBe('second');
    expect(mocks.listTools).toHaveBeenLastCalledWith({ cursor: 'next' });
    expect(mocks.transport.mock.calls[0][1].requestInit.redirect).toBe('error');
    expect(mocks.close).toHaveBeenCalled();
  });

  it('forwards JSON arguments and returns failure for tool errors', async () => {
    mocks.callTool.mockResolvedValue({ isError: true, content: [] });
    expect(await run(['call', 'create_task', '{"title":"Test"}'], env, output)).toBe(1);
    expect(mocks.callTool).toHaveBeenCalledWith({ name: 'create_task', arguments: { title: 'Test' } });
    expect(mocks.close).toHaveBeenCalled();
  });

  it('rejects invalid inputs before connecting', async () => {
    await expect(run(['call', 'create_task', '[]'], env, output)).rejects.toThrow('JSON object');
    await expect(run(['tools'], { ...env, MILLER_TOKEN: '' }, output)).rejects.toThrow('MILLER_TOKEN');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

it('sends token management through the separate user session endpoint', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  try {
    const code = await run(['tokens', 'list', '{}'], { ...env, MILLER_USER_ACCESS_TOKEN: 'user-session' }, output);
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://example.com/api/cli/tokens'), expect.objectContaining({
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: 'Bearer user-session' }),
      body: '{"action":"list"}',
    }));
  } finally { fetchMock.mockRestore(); }
});

it('signs in without persisting a session and returns the access token', async () => {
  mocks.signIn.mockResolvedValue({ data: { session: { access_token: 'user-session' } }, error: null });
  const authEnv = { ...env, MILLER_SUPABASE_URL: 'https://project.supabase.co', MILLER_SUPABASE_ANON_KEY: 'public', MILLER_EMAIL: 'user@example.com', MILLER_PASSWORD: 'password' };
  expect(await run(['auth', 'login'], authEnv, output)).toBe(0);
  expect(mocks.signIn).toHaveBeenCalledWith({ email: 'user@example.com', password: 'password' });
  expect(output.log).toHaveBeenCalledWith('user-session');
});

it('maps convenient commands onto the existing tools', async () => {
  mocks.callTool.mockResolvedValue({ content: [], isError: false });
  expect(await run(['tasks', 'create', 'Plan launch', '--priority', 'high', '--due', '2026-11-09T12:00:00Z'], env, output)).toBe(0);
  expect(mocks.callTool).toHaveBeenCalledWith({ name: 'create_task', arguments: { title: 'Plan launch', priority: 'high', due_date: '2026-11-09T12:00:00Z' } });
  await run(['notifications', 'list', '--unread', '--limit', '10'], env, output);
  expect(mocks.callTool).toHaveBeenLastCalledWith({ name: 'list_notifications', arguments: { unread_only: true, limit: 10 } });
});

it('validates deletion and flags before connecting', async () => {
  await expect(run(['tasks', 'delete', 'abc'], env, output)).rejects.toThrow('--confirm-title');
  await expect(run(['content', 'delete', 'abc'], env, output)).rejects.toThrow('--confirm-delete');
  await expect(run(['tasks', 'list', '--limit', 'bad'], env, output)).rejects.toThrow('whole number');
  await expect(run(['tasks', 'list', '--unknown'], env, output)).rejects.toThrow('Unknown option');
  expect(mocks.connect).not.toHaveBeenCalled();
});
