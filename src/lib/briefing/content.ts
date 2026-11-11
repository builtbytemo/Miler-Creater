import type { BriefingContentGenerator } from './types';

/**
 * Placeholder generator. Real briefing content is designed separately; until a generator is
 * registered, scheduled deliveries are marked "skipped" and nothing is sent.
 */
export const unconfiguredContentGenerator: BriefingContentGenerator = {
  async generate() {
    return { status: 'not_configured', reason: 'No briefing content generator is registered' };
  },
};

let registered: BriefingContentGenerator | null = null;

export function registerBriefingContentGenerator(g: BriefingContentGenerator | null) {
  registered = g;
}

export function getBriefingContentGenerator(): BriefingContentGenerator {
  return registered ?? unconfiguredContentGenerator;
}

export function isBriefingContentConfigured(): boolean {
  return registered !== null;
}
