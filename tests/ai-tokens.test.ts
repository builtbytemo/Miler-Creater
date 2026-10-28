import { describe, it, expect } from 'vitest';
import {
  generateAiToken,
  hashAiToken,
  validateScopes,
  hasRequiredScope,
  requiresUserConfirmation,
  VALID_AI_SCOPES,
  HIGH_RISK_OPERATIONS,
} from '../src/lib/ai/tokens';

describe('AI API Tokens & Permission Safeguards', () => {
  it('generates high-entropy tokens with standard prefix', () => {
    const tokenData = generateAiToken();

    expect(tokenData.rawToken).toMatch(/^ctc_live_[a-f0-9]{64}$/);
    expect(tokenData.tokenPrefix).toMatch(/^ctc_live_[a-f0-9]{8}$/);
    expect(tokenData.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenData.tokenHash).toBe(hashAiToken(tokenData.rawToken));
  });

  it('generates unique tokens on subsequent calls', () => {
    const t1 = generateAiToken();
    const t2 = generateAiToken();

    expect(t1.rawToken).not.toBe(t2.rawToken);
    expect(t1.tokenHash).not.toBe(t2.tokenHash);
  });

  it('validates allowed scopes from catalog', () => {
    expect(validateScopes(['content:read', 'task:read'])).toBe(true);
    expect(validateScopes([...VALID_AI_SCOPES])).toBe(true);
    expect(validateScopes(['invalid:scope'])).toBe(false);
    expect(validateScopes([])).toBe(false);
  });

  it('enforces specific scope requirements', () => {
    const grantedScopes = ['content:read', 'task:read', 'task:write'];

    expect(hasRequiredScope(grantedScopes, 'content:read')).toBe(true);
    expect(hasRequiredScope(grantedScopes, 'task:write')).toBe(true);
    expect(hasRequiredScope(grantedScopes, 'content:write')).toBe(false);
    expect(hasRequiredScope(grantedScopes, 'calendar:reschedule')).toBe(false);
  });

  it('classifies high-risk operations as requiring human confirmation regardless of granted scopes', () => {
    HIGH_RISK_OPERATIONS.forEach((op) => {
      expect(requiresUserConfirmation(op, [...VALID_AI_SCOPES])).toBe(true);
    });
  });

  it('does not require confirmation for standard read operations unless explicitly configured', () => {
    expect(requiresUserConfirmation('search_content', ['content:read'])).toBe(false);
    expect(requiresUserConfirmation('list_tasks', ['task:read'])).toBe(false);
    expect(requiresUserConfirmation('get_calendar_view', ['calendar:read'])).toBe(false);
  });

  it('forces confirmation on all mutations when action:confirm_required is present', () => {
    const scopedWithConfirm = ['content:write', 'task:write', 'action:confirm_required'];

    expect(requiresUserConfirmation('create_content_item', scopedWithConfirm)).toBe(true);
    expect(requiresUserConfirmation('create_task', scopedWithConfirm)).toBe(true);
    expect(requiresUserConfirmation('update_task', scopedWithConfirm)).toBe(true);
    // Read operations still don't require confirmation
    expect(requiresUserConfirmation('search_content', scopedWithConfirm)).toBe(false);
  });
});
