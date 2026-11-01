/**
 * Validates and sanitizes redirect paths to strictly prevent Open Redirect vulnerabilities.
 * Only internal, relative paths starting with a single '/' are permitted.
 *
 * Rejects:
 * - Protocol-relative URLs: '//attacker.com'
 * - Windows-style / backslash bypasses: '/\\attacker.com' or '\attacker.com'
 * - Absolute URIs with schemes: 'https://attacker.com', 'javascript:alert(1)'
 * - Null, undefined, or empty strings
 */
export function getSafeRedirectPath(
  rawPath: string | null | undefined,
  fallback = '/dashboard'
): string {
  if (!rawPath || typeof rawPath !== 'string') {
    return fallback;
  }

  const trimmed = rawPath.trim();

  // Must start with '/' but NOT '//' or '/\'
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  // Must not contain backslashes or control characters
  if (trimmed.includes('\\') || /[\x00-\x1F\x7F]/.test(trimmed)) {
    return fallback;
  }

  // Must not contain explicit protocols in the pathname segment (e.g. '/http://attacker.com')
  // while permitting query parameters containing URLs or scope colons (e.g. '?redirect_uri=https://...&scope=task:read')
  const pathOnly = trimmed.split(/[?#]/)[0];
  if (/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pathOnly)) {
    return fallback;
  }

  // Ensure path is valid relative URL
  try {
    const dummyBase = 'http://localhost';
    const parsed = new URL(trimmed, dummyBase);
    // Verified that origin remains dummyBase and pathname is internal
    if (
      parsed.origin !== dummyBase ||
      !parsed.pathname.startsWith('/') ||
      parsed.pathname.startsWith('//')
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
