import { describe, it, expect } from 'vitest';
import { validateRedirectUri } from '@/lib/mcp/oauth';

describe('ChatGPT OAuth redirect URIs', () => {
  it.each([
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/abc123_DEF-9',
    'https://platform.openai.com/apps-manage/oauth',
  ])('accepts %s', (uri) => {
    expect(validateRedirectUri(uri).valid).toBe(true);
  });

  it.each([
    'https://chatgpt.com/connector/oauth/',
    'https://chatgpt.com/connector/oauth/a/b',
    'https://chatgpt.com.evil.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/other',
  ])('rejects %s', (uri) => {
    expect(validateRedirectUri(uri).valid).toBe(false);
  });
});
