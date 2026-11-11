import type { BriefingContentGenerator } from './types';

/**
 * Placeholder generator, kept for tests and as an explicit "send nothing" override
 * (registerBriefingContentGenerator(unconfiguredContentGenerator)).
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

/** The approved generator (daily/generator.ts) is built in, so content is always configured. */
export function isBriefingContentConfigured(): boolean {
  return true;
}

/** Explicit override registered via registerBriefingContentGenerator, if any. */
export function getRegisteredBriefingContentGenerator(): BriefingContentGenerator | null {
  return registered;
}
