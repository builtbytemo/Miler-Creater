import { isBriefingContentConfigured } from './content';

const ZAHI_KNOWN_STAGING_SUPABASE_HOST = 'prmgrrzqtnygmitplkhn.supabase.co';
const ZAHI_KNOWN_GITHUB_OWNER = 'builtbytemo';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/** Booleans only; never returns secret values or private addresses. */
export interface DeliveryServiceStatus {
  schedulerEnabled: boolean;
  telegramConfigured: boolean;
  emailConfigured: boolean;
  contentConfigured: boolean;
  emailRecipientMismatch?: boolean;
}

export type EmailDeliveryPolicy =
  | {
      mode: 'staging';
      credentialsConfigured: boolean;
      configured: boolean;
    }
  | {
      mode: 'single_user';
      credentialsConfigured: boolean;
      restrictionConfigured: boolean;
      configured: boolean;
      allowedUserId: string | null;
      allowedRecipient: string | null;
    };

export function normalizeEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n\0\s<>,"']/.test(trimmed)) return null;
  return EMAIL_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function parseValidEmailFrom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed)) return null;
  const angleMatch = trimmed.match(/^([^<>]+)<([^<>]+)>$/);
  if (angleMatch) {
    const displayName = angleMatch[1].trim();
    const addr = normalizeEmailAddress(angleMatch[2]);
    if (!displayName || !addr) return null;
    return trimmed;
  }
  return normalizeEmailAddress(trimmed);
}

export function parseValidUuid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

function parseStrictHttpsHost(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isKnownZahiStagingTarget(): boolean {
  if (process.env.VERCEL_ENV?.trim() !== 'preview') return false;

  const publicHost = parseStrictHttpsHost(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (publicHost !== ZAHI_KNOWN_STAGING_SUPABASE_HOST) return false;

  const serverUrl = process.env.SUPABASE_URL?.trim();
  if (serverUrl && parseStrictHttpsHost(serverUrl) !== ZAHI_KNOWN_STAGING_SUPABASE_HOST) {
    return false;
  }

  // Defense in depth: never allow staging bypass if Vercel Git metadata identifies another owner.
  const repoOwner = process.env.VERCEL_GIT_REPO_OWNER?.trim().toLowerCase();
  if (repoOwner && repoOwner !== ZAHI_KNOWN_GITHUB_OWNER) return false;

  return true;
}

export function getResendCredentials(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim() || '';
  const from = parseValidEmailFrom(process.env.EMAIL_FROM);
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/**
 * Resolves the email delivery policy with fail-closed defaults:
 * - Defaults to restricted `single_user` mode across ALL hosting environments, including
 *   independently hosted Vercel Preview, Vercel Production, and non-Vercel deployments.
 * - Unrestricted multi-user testing mode is enabled ONLY on Zahi's known staging deployment
 *   (`VERCEL_ENV=preview` pointing strictly to `https://prmgrrzqtnygmitplkhn.supabase.co`,
 *   not overridden by third-party repo metadata or single-user allowlist variables).
 * - In `single_user` mode, delivery requires BOTH Resend credentials AND a valid allowlist
 *   (`DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID` + `DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT`).
 */
export function getEmailDeliveryPolicy(): EmailDeliveryPolicy {
  const credentialsConfigured = Boolean(getResendCredentials());
  const rawAllowedUserId = process.env.DAILY_BRIEFING_EMAIL_ALLOWED_USER_ID;
  const rawAllowedRecipient = process.env.DAILY_BRIEFING_EMAIL_ALLOWED_RECIPIENT;
  const hasAnyRestrictionVar = rawAllowedUserId !== undefined || rawAllowedRecipient !== undefined;

  if (!hasAnyRestrictionVar && isKnownZahiStagingTarget()) {
    return {
      mode: 'staging',
      credentialsConfigured,
      configured: credentialsConfigured,
    };
  }

  const allowedUserId = parseValidUuid(rawAllowedUserId);
  const allowedRecipient = normalizeEmailAddress(rawAllowedRecipient);
  const restrictionConfigured = Boolean(allowedUserId && allowedRecipient);

  return {
    mode: 'single_user',
    credentialsConfigured,
    restrictionConfigured,
    configured: credentialsConfigured && restrictionConfigured,
    allowedUserId: restrictionConfigured ? allowedUserId : null,
    allowedRecipient: restrictionConfigured ? allowedRecipient : null,
  };
}

export function canEnqueueEmailForUser(userId: string): boolean {
  const policy = getEmailDeliveryPolicy();
  if (policy.mode === 'staging') return true;
  if (!policy.configured || !policy.allowedUserId) return false;
  return userId.trim().toLowerCase() === policy.allowedUserId;
}

export function authorizeEmailDispatch(
  userId: string
): { allowed: true } | { allowed: false; code: 'email_not_configured' | 'email_user_unauthorized' } {
  const policy = getEmailDeliveryPolicy();
  if (policy.mode === 'staging') return { allowed: true };
  if (!policy.configured || !policy.allowedUserId) {
    return { allowed: false, code: 'email_not_configured' };
  }
  if (userId.trim().toLowerCase() !== policy.allowedUserId) {
    return { allowed: false, code: 'email_user_unauthorized' };
  }
  return { allowed: true };
}

export function authorizeEmailDestination(
  to: string,
  userId?: string
): { allowed: true; normalizedTo: string } | { allowed: false; kind: 'not_configured' | 'permanent'; code: string } {
  const normalizedTo = normalizeEmailAddress(to);
  const policy = getEmailDeliveryPolicy();

  if (policy.mode === 'staging') {
    if (!normalizedTo) return { allowed: false, kind: 'permanent', code: 'email_invalid_destination' };
    return { allowed: true, normalizedTo };
  }

  if (!policy.restrictionConfigured || !policy.allowedUserId || !policy.allowedRecipient) {
    return { allowed: false, kind: 'not_configured', code: 'email_restriction_not_configured' };
  }
  if (userId !== undefined && userId.trim().toLowerCase() !== policy.allowedUserId) {
    return { allowed: false, kind: 'permanent', code: 'email_user_unauthorized' };
  }
  if (!normalizedTo || normalizedTo !== policy.allowedRecipient) {
    return { allowed: false, kind: 'permanent', code: 'email_recipient_unauthorized' };
  }
  return { allowed: true, normalizedTo };
}

export function getEmailAccessForUser(
  userId: string,
  verifiedEmail: string | null | undefined,
  emailConfirmed: boolean
): {
  configuredForUser: boolean;
  authorizedUser: boolean;
  destinationAuthorized: boolean;
  reason: 'not_configured' | 'user_unauthorized' | 'email_unverified' | 'recipient_mismatch' | null;
} {
  const policy = getEmailDeliveryPolicy();
  if (!policy.configured) {
    return { configuredForUser: false, authorizedUser: false, destinationAuthorized: false, reason: 'not_configured' };
  }

  const normalizedUserEmail = normalizeEmailAddress(verifiedEmail);
  if (policy.mode === 'staging') {
    const confirmed = Boolean(emailConfirmed && normalizedUserEmail);
    return {
      configuredForUser: true,
      authorizedUser: true,
      destinationAuthorized: confirmed,
      reason: confirmed ? null : 'email_unverified',
    };
  }

  if (!policy.allowedUserId || userId.trim().toLowerCase() !== policy.allowedUserId) {
    return {
      configuredForUser: false,
      authorizedUser: false,
      destinationAuthorized: false,
      reason: 'user_unauthorized',
    };
  }

  if (!emailConfirmed || !normalizedUserEmail) {
    return {
      configuredForUser: true,
      authorizedUser: true,
      destinationAuthorized: false,
      reason: 'email_unverified',
    };
  }

  if (normalizedUserEmail !== policy.allowedRecipient) {
    return {
      configuredForUser: false,
      authorizedUser: true,
      destinationAuthorized: false,
      reason: 'recipient_mismatch',
    };
  }

  return {
    configuredForUser: true,
    authorizedUser: true,
    destinationAuthorized: true,
    reason: null,
  };
}

export function getTelegramBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function getTelegramBotUsername(): string | null {
  const u = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  return u && /^[A-Za-z0-9_]{3,64}$/.test(u) ? u : null;
}

export function getDeliveryServiceStatus(): DeliveryServiceStatus {
  return {
    schedulerEnabled: process.env.DAILY_BRIEFING_DELIVERY_ENABLED === 'true',
    telegramConfigured: Boolean(
      getTelegramBotToken() && getTelegramBotUsername() && process.env.TELEGRAM_WEBHOOK_SECRET
    ),
    emailConfigured: getEmailDeliveryPolicy().configured,
    contentConfigured: isBriefingContentConfigured(),
  };
}
