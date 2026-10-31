import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { checkTokenRateLimit } from '@/lib/mcp/rate-limiter';

describe('AI Token Rate Limiter Atomicity & Fail-Closed Invariants (Phase 7.4.1)', () => {
  const tokenId = '123e4567-e89b-12d3-a456-426614174099';
  const refTime = new Date('2026-10-30T12:00:00.000Z');

  describe('PostgreSQL RPC Integration Contract', () => {
    it('calls check_and_increment_ai_token_rate_limit with exact arguments', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [
          {
            allowed: true,
            remaining_requests: 59,
            retry_after_seconds: 0,
            current_count: 1,
          },
        ],
        error: null,
      });

      const client = { rpc: mockRpc } as unknown as SupabaseClient<Database>;

      const result = await checkTokenRateLimit(client, tokenId, {
        windowSeconds: 60,
        maxRequests: 60,
        referenceTime: refTime,
      });

      expect(mockRpc).toHaveBeenCalledWith('check_and_increment_ai_token_rate_limit', {
        p_token_id: tokenId,
        p_window_seconds: 60,
        p_max_requests: 60,
        p_now: refTime.toISOString(),
      });

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(59);
      expect(result.retryAfterSeconds).toBe(0);
      expect(result.currentCount).toBe(1);
    });

    it('returns allowed: false when atomic RPC signals quota exhaustion', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [
          {
            allowed: false,
            remaining_requests: 0,
            retry_after_seconds: 42,
            current_count: 60,
          },
        ],
        error: null,
      });

      const client = { rpc: mockRpc } as unknown as SupabaseClient<Database>;

      const result = await checkTokenRateLimit(client, tokenId, {
        windowSeconds: 60,
        maxRequests: 60,
        referenceTime: refTime,
      });

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfterSeconds).toBe(42);
      expect(result.currentCount).toBe(60);
    });
  });

  describe('Fail-Closed Invariants', () => {
    it('fails closed (allowed: false) when the atomic database RPC returns an error', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection timeout', code: '08006' },
      });

      const client = { rpc: mockRpc } as unknown as SupabaseClient<Database>;

      const result = await checkTokenRateLimit(client, tokenId, {
        windowSeconds: 60,
        maxRequests: 60,
      });

      // MUST FAIL CLOSED: Network or database errors must NEVER grant free access
      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfterSeconds).toBe(60);
    });

    it('fails closed when the database RPC call throws an exception', async () => {
      const mockRpc = vi.fn().mockRejectedValue(new Error('PostgreSQL socket closed'));

      const client = { rpc: mockRpc } as unknown as SupabaseClient<Database>;

      const result = await checkTokenRateLimit(client, tokenId);

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfterSeconds).toBe(60);
    });

    it('fails closed in table-fallback mode when table query encounters an error', async () => {
      const client = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'relation ai_token_rate_limits does not exist' },
              }),
            })),
          })),
        })),
      } as unknown as SupabaseClient<Database>;

      const result = await checkTokenRateLimit(client, tokenId);

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfterSeconds).toBe(60);
    });
  });

  describe('Simulation of Window Expiration in Fallback Mode', () => {
    it('resets window and allows request when elapsed time exceeds windowSeconds', async () => {
      let state = {
        window_start: new Date(refTime.getTime() - 65000).toISOString(), // 65s ago
        request_count: 60, // full
      };

      const client = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: state, error: null }),
            })),
          })),
          update: vi.fn((updates: any) => ({
            eq: vi.fn(() => {
              state = { ...state, ...updates };
              return Promise.resolve({ error: null });
            }),
          })),
        })),
      } as unknown as SupabaseClient<Database>;

      const result = await checkTokenRateLimit(client, tokenId, {
        windowSeconds: 60,
        maxRequests: 60,
        referenceTime: refTime,
      });

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(59);
      expect(result.currentCount).toBe(1);
      expect(state.request_count).toBe(1);
      expect(state.window_start).toBe(refTime.toISOString());
    });
  });
});
