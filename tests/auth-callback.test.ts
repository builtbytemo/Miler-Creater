import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET,
  isAllowedEmailOtpType,
  ALLOWED_EMAIL_OTP_TYPES,
} from '../src/app/auth/callback/route';

const mockExchangeCodeForSession = vi.fn();
const mockVerifyOtp = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      verifyOtp: mockVerifyOtp,
    },
  })),
}));

describe('Auth Callback Route Handler (OAuth & Email Verification)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAllowedEmailOtpType Guard', () => {
    it('approves legitimate verification types', () => {
      ALLOWED_EMAIL_OTP_TYPES.forEach((type) => {
        expect(isAllowedEmailOtpType(type)).toBe(true);
      });
    });

    it('rejects unsupported, empty, or malicious verification types', () => {
      expect(isAllowedEmailOtpType(null)).toBe(false);
      expect(isAllowedEmailOtpType(undefined)).toBe(false);
      expect(isAllowedEmailOtpType('')).toBe(false);
      expect(isAllowedEmailOtpType('sms')).toBe(false);
      expect(isAllowedEmailOtpType('phone_change')).toBe(false);
      expect(isAllowedEmailOtpType('arbitrary_exploit')).toBe(false);
      expect(isAllowedEmailOtpType('__proto__')).toBe(false);
    });
  });

  describe('OAuth / PKCE Code Flow', () => {
    it('successfully exchanges valid code and redirects to dashboard by default', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new NextRequest('http://localhost:3000/auth/callback?code=valid-auth-code');
      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-auth-code');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    it('respects validated relative next parameter upon successful exchange', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new NextRequest(
        'http://localhost:3000/auth/callback?code=valid-code&next=/tasks'
      );
      const response = await GET(request);

      expect(response.headers.get('location')).toBe('http://localhost:3000/tasks');
    });

    it('sanitizes open-redirect attempts in next parameter to /dashboard', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new NextRequest(
        'http://localhost:3000/auth/callback?code=valid-code&next=//attacker.com'
      );
      const response = await GET(request);

      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    it('redirects to sign-in with FailedToExchangeSession when exchange returns an error', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({
        error: { message: 'Invalid PKCE code verifier', status: 400 },
      });

      const request = new NextRequest('http://localhost:3000/auth/callback?code=invalid-code');
      const response = await GET(request);

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=FailedToExchangeSession'
      );
    });

    it('handles unexpected exchange exceptions gracefully', async () => {
      mockExchangeCodeForSession.mockRejectedValueOnce(new Error('Network failure'));

      const request = new NextRequest('http://localhost:3000/auth/callback?code=bad-code');
      const response = await GET(request);

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=FailedToExchangeSession'
      );
    });
  });

  describe('Email OTP / Token Hash Verification Flow', () => {
    it('successfully verifies valid token_hash and signup type', async () => {
      mockVerifyOtp.mockResolvedValueOnce({ error: null });

      const request = new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=valid-token-hash&type=signup'
      );
      const response = await GET(request);

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        token_hash: 'valid-token-hash',
        type: 'signup',
      });
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    it('successfully verifies email confirmation alias type=email with custom next path', async () => {
      mockVerifyOtp.mockResolvedValueOnce({ error: null });

      const request = new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=hash-123&type=email&next=/settings'
      );
      const response = await GET(request);

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        token_hash: 'hash-123',
        type: 'email',
      });
      expect(response.headers.get('location')).toBe('http://localhost:3000/settings');
    });

    it('supports recovery type for password reset verification', async () => {
      mockVerifyOtp.mockResolvedValueOnce({ error: null });

      const request = new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=recovery-hash&type=recovery&next=/auth/reset-password'
      );
      const response = await GET(request);

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        token_hash: 'recovery-hash',
        type: 'recovery',
      });
      expect(response.headers.get('location')).toBe('http://localhost:3000/auth/reset-password');
    });

    it('rejects unsupported verification types without invoking verifyOtp', async () => {
      const request = new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=hash-123&type=unsupported_type'
      );
      const response = await GET(request);

      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=InvalidVerificationType'
      );
    });

    it('redirects to sign-in with FailedToVerifySession when verifyOtp returns an error', async () => {
      mockVerifyOtp.mockResolvedValueOnce({
        error: { message: 'Token has expired or is invalid', status: 401 },
      });

      const request = new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=expired-hash&type=signup'
      );
      const response = await GET(request);

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=FailedToVerifySession'
      );
    });

    it('handles unexpected verifyOtp exceptions gracefully', async () => {
      mockVerifyOtp.mockRejectedValueOnce(new Error('Internal auth server error'));

      const request = new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=failing-hash&type=signup'
      );
      const response = await GET(request);

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=FailedToVerifySession'
      );
    });
  });

  describe('Incoming Supabase Error Handling', () => {
    it('maps expired OTP errors to VerificationLinkExpired without leaking tokens', async () => {
      const request = new NextRequest(
        'http://localhost:3000/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
      );
      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=VerificationLinkExpired'
      );
    });

    it('maps generic auth callback errors safely', async () => {
      const request = new NextRequest(
        'http://localhost:3000/auth/callback?error=server_error&error_description=internal+failure'
      );
      const response = await GET(request);

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=AuthCallbackError'
      );
    });
  });

  describe('Missing Parameter Fallback', () => {
    it('redirects to InvalidAuthCallback when neither code nor token_hash is supplied', async () => {
      const request = new NextRequest('http://localhost:3000/auth/callback');
      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=InvalidAuthCallback'
      );
    });

    it('redirects to InvalidAuthCallback when token_hash is supplied without type', async () => {
      const request = new NextRequest(
        'http://localhost:3000/auth/callback?token_hash=hash-without-type'
      );
      const response = await GET(request);

      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/sign-in?error=InvalidAuthCallback'
      );
    });
  });
});
