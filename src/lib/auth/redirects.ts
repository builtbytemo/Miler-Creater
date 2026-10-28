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

  // Must not contain backslashes
  if (trimmed.includes('\\')) {
    return fallback;
  }

  // Must not contain explicit protocols (e.g. '/http://attacker.com')
  if (/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Ensure path is valid relative URL
  try {
    const dummyBase = 'http://localhost';
    const parsed = new URL(trimmed, dummyBase);
    // Verified that origin remains dummyBase and pathname is internal
    if (parsed.origin !== dummyBase) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
