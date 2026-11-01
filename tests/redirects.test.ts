import { describe, it, expect } from 'vitest';
import { getSafeRedirectPath } from '../src/lib/auth/redirects';

describe('Safe Redirect Path Validation (Open Redirect Prevention)', () => {
  it('allows safe relative paths', () => {
    expect(getSafeRedirectPath('/dashboard')).toBe('/dashboard');
    expect(getSafeRedirectPath('/settings/security')).toBe('/settings/security');
    expect(getSafeRedirectPath('/tasks?filter=urgent#today')).toBe('/tasks?filter=urgent#today');
    expect(getSafeRedirectPath('/auth/reset-password')).toBe('/auth/reset-password');
  });

  it('rejects protocol-relative URLs and falls back to /dashboard', () => {
    expect(getSafeRedirectPath('//attacker.com')).toBe('/dashboard');
    expect(getSafeRedirectPath('//evil.com/phishing')).toBe('/dashboard');
    expect(getSafeRedirectPath('///evil.com')).toBe('/dashboard');
  });

  it('rejects Windows backslash bypass attempts', () => {
    expect(getSafeRedirectPath('/\\attacker.com')).toBe('/dashboard');
    expect(getSafeRedirectPath('\\attacker.com')).toBe('/dashboard');
    expect(getSafeRedirectPath('/path\\to\\evil')).toBe('/dashboard');
  });

  it('rejects absolute external URLs', () => {
    expect(getSafeRedirectPath('https://attacker.com')).toBe('/dashboard');
    expect(getSafeRedirectPath('http://attacker.com/dashboard')).toBe('/dashboard');
    expect(getSafeRedirectPath('javascript:alert(1)')).toBe('/dashboard');
    expect(getSafeRedirectPath('data:text/html,evil')).toBe('/dashboard');
  });

  it('handles null, undefined, and non-string inputs safely', () => {
    expect(getSafeRedirectPath(null)).toBe('/dashboard');
    expect(getSafeRedirectPath(undefined)).toBe('/dashboard');
    expect(getSafeRedirectPath('')).toBe('/dashboard');
    expect(getSafeRedirectPath('   ')).toBe('/dashboard');
  });

  it('respects custom fallback path when provided', () => {
    expect(getSafeRedirectPath('https://attacker.com', '/auth/sign-in')).toBe('/auth/sign-in');
  });

  it('preserves OAuth authorization query strings containing URLs and scope colons', () => {
    const oauthRedirect =
      '/oauth/authorize?response_type=code&client_id=ctc_client_123&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&scope=task%3Aread+content%3Aread&resource=https%3A%2F%2Fmiler-creater.vercel.app%2Fapi%2Fmcp&state=abc123';
    expect(getSafeRedirectPath(oauthRedirect)).toBe(oauthRedirect);

    const unencodedOauthRedirect =
      '/oauth/authorize?redirect_uri=https://claude.ai/api/mcp/auth_callback&scope=task:read+task:write&state=xyz';
    expect(getSafeRedirectPath(unencodedOauthRedirect)).toBe(unencodedOauthRedirect);
  });

  it('still rejects protocol schemes embedded in the pathname segment', () => {
    expect(getSafeRedirectPath('/http://attacker.com')).toBe('/dashboard');
    expect(getSafeRedirectPath('/https://attacker.com?scope=task:read')).toBe('/dashboard');
    expect(getSafeRedirectPath('/javascript:alert(1)?next=/dashboard')).toBe('/dashboard');
  });
});
