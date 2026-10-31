import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HomePage from '../src/app/page';

const mockConnection = vi.fn();
const mockRedirect = vi.fn();
const mockGetUser = vi.fn();

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT: ${url}`);
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

describe('HomePage Server Component (Prerendering & Dynamic Request Resolution)', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'example-anon-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it('calls await connection() before requesting auth session or inspecting cookies', async () => {
    const order: string[] = [];
    mockConnection.mockImplementationOnce(async () => {
      order.push('connection');
    });
    mockGetUser.mockImplementationOnce(async () => {
      order.push('getUser');
      return { data: { user: null } };
    });

    await HomePage();

    expect(order).toEqual(['connection', 'getUser']);
  });

  it('redirects authenticated users to /dashboard at request time', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-active-123' } } });

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT: /dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  it('renders landing page when visitor is unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const result = await HomePage();
    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('renders landing page gracefully without checking auth when Supabase is unconfigured', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';

    const result = await HomePage();
    expect(result).toBeDefined();
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});
