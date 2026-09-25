// List prices only — nothing here is billed (free tiers, see CLAUDE.md).
// Verified against provider pricing pages 2026-09-13.
export const PRICING_VERIFIED_AT = '2026-09-13';

export interface ModelPricing {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number | null;
  outputPerMillionUsd: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'openai/gpt-oss-120b': {
    inputPerMillionUsd: 0.15,
    cachedInputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.6,
  },
  'openai/gpt-oss-20b': {
    inputPerMillionUsd: 0.075,
    cachedInputPerMillionUsd: 0.037,
    outputPerMillionUsd: 0.3,
  },
  'gemini-3.8-flash': {
    inputPerMillionUsd: 0.75,
    cachedInputPerMillionUsd: null,
    outputPerMillionUsd: 3.75,
  },
};

export function listPriceUsdFor(
  model: string,
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;

  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  const cachedRate = pricing.cachedInputPerMillionUsd ?? pricing.inputPerMillionUsd;

  return (
    (uncachedInputTokens * pricing.inputPerMillionUsd) / 1_000_000 +
    (usage.cachedInputTokens * cachedRate) / 1_000_000 +
    (usage.outputTokens * pricing.outputPerMillionUsd) / 1_000_000
  );
}
