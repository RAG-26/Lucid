import { describe, expect, it } from 'vitest';
import { listPriceUsdFor } from './pricing.js';

describe('listPriceUsdFor', () => {
  it('prices uncached input, cached input, and output at their separate list rates', () => {
    // gpt-oss-20b: 0.075 / 0.037 / 0.30 per 1M (input / cached input / output)
    const usd = listPriceUsdFor('openai/gpt-oss-20b', {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 1_000_000,
    });

    // uncached input: 600K * 0.075/1M = 0.045; cached input: 400K * 0.037/1M = 0.0148; output: 1M * 0.30/1M = 0.30
    expect(usd).toBeCloseTo(0.045 + 0.0148 + 0.3, 6);
  });

  it('falls back to the base input rate for a model with no separate cached price', () => {
    // gemini-3.8-flash has cachedInputPerMillionUsd: null
    const usd = listPriceUsdFor('gemini-3.8-flash', {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    });

    expect(usd).toBeCloseTo(0.75, 6);
  });

  it('returns 0 for an unpriced model instead of throwing', () => {
    const usd = listPriceUsdFor('some-future-model', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    });

    expect(usd).toBe(0);
  });

  it('returns 0 for a call with no tokens', () => {
    const usd = listPriceUsdFor('openai/gpt-oss-120b', { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
    expect(usd).toBe(0);
  });
});
