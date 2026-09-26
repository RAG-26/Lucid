import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../test/clock.js';
import { QuotaExhaustedError } from './errors.js';
import { createRateLimiter } from './rate-limiter.js';
import type { QuotaLimits } from './types.js';

const KEY = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const OTHER_MODEL_KEY = { provider: 'groq', model: 'openai/gpt-oss-120b' };

const GENEROUS: QuotaLimits = { rpm: 1000, tpm: 1_000_000, rpd: 1000, tpd: 1_000_000 };

function limiterWith(limits: QuotaLimits) {
  const clock = createFakeClock();
  const limiter = createRateLimiter({ limits: () => limits, clock });
  return { clock, limiter };
}

describe('createRateLimiter', () => {
  it('allows a burst up to the RPM limit, then waits for the oldest request to leave the window', async () => {
    const { clock, limiter } = limiterWith({ ...GENEROUS, rpm: 3 });

    for (let i = 0; i < 3; i += 1) {
      const r = await limiter.reserve(KEY, 10);
      expect(r.waitedMs).toBe(0);
    }

    const fourth = await limiter.reserve(KEY, 10);
    expect(fourth.waitedMs).toBe(60_000);
    expect(clock.currentTime).toBe(60_000);
  });

  it('waits when projected TPM would exceed the limit even though RPM has room', async () => {
    const { clock, limiter } = limiterWith({ ...GENEROUS, rpm: 100, tpm: 100 });

    const first = await limiter.reserve(KEY, 80);
    expect(first.waitedMs).toBe(0);

    const second = await limiter.reserve(KEY, 50); // 80 + 50 > 100
    expect(second.waitedMs).toBe(60_000);
    expect(clock.currentTime).toBe(60_000);
  });

  it('frees TPM budget immediately when commit() reports fewer tokens than estimated', async () => {
    const { limiter } = limiterWith({ ...GENEROUS, rpm: 100, tpm: 100 });

    const first = await limiter.reserve(KEY, 80);
    first.commit(20); // actual usage was much less than the estimate

    const second = await limiter.reserve(KEY, 50); // 20 + 50 <= 100, no wait needed
    expect(second.waitedMs).toBe(0);
  });

  it('release() undoes a reservation that never happened', async () => {
    const { limiter } = limiterWith({ ...GENEROUS, rpm: 100, tpm: 100 });

    const first = await limiter.reserve(KEY, 80);
    first.release();

    const second = await limiter.reserve(KEY, 80); // would exceed 100 if the first still counted
    expect(second.waitedMs).toBe(0);
  });

  it('blocks the bucket for retry-after seconds after a 429', async () => {
    const { clock, limiter } = limiterWith(GENEROUS);

    limiter.noteRetryAfter(KEY, 2);
    const reservation = await limiter.reserve(KEY, 10);

    expect(reservation.waitedMs).toBe(2000);
    expect(clock.currentTime).toBe(2000);
  });

  it('throws QuotaExhaustedError on TPD exhaustion without sleeping', async () => {
    const { clock, limiter } = limiterWith({ ...GENEROUS, tpd: 100 });

    await limiter.reserve(KEY, 50);
    await expect(limiter.reserve(KEY, 60)).rejects.toThrow(QuotaExhaustedError);
    expect(clock.currentTime).toBe(0); // no sleeping — this is a hard stop, not a wait
  });

  it('throws QuotaExhaustedError on RPD exhaustion without sleeping', async () => {
    const { clock, limiter } = limiterWith({ ...GENEROUS, rpd: 1 });

    await limiter.reserve(KEY, 10);
    const error = await limiter.reserve(KEY, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect((error as InstanceType<typeof QuotaExhaustedError>).kind).toBe('rpd');
    expect(clock.currentTime).toBe(0);
  });

  it('tracks independent buckets per provider:model', async () => {
    const { limiter } = limiterWith({ ...GENEROUS, rpd: 1 });

    await limiter.reserve(KEY, 10);
    // A different model's bucket is unaffected by the first model's exhausted RPD.
    await expect(limiter.reserve(OTHER_MODEL_KEY, 10)).resolves.toBeDefined();
    await expect(limiter.reserve(KEY, 10)).rejects.toThrow(QuotaExhaustedError);
  });

  it('waits when header-reported remaining tokens are stricter than the local estimate', async () => {
    const { clock, limiter } = limiterWith({ ...GENEROUS, tpm: 100_000 });

    limiter.noteHeaders(KEY, {
      'x-ratelimit-remaining-tokens': '5',
      'x-ratelimit-reset-tokens': '3s',
    });

    const reservation = await limiter.reserve(KEY, 10); // 10 > the reported 5 remaining
    expect(reservation.waitedMs).toBe(3000);
    expect(clock.currentTime).toBe(3000);
  });

  it('parses a minutes-only Groq duration header', async () => {
    const { clock, limiter } = limiterWith({ ...GENEROUS, tpm: 100_000 });

    limiter.noteHeaders(KEY, {
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-reset-tokens': '1m',
    });

    const reservation = await limiter.reserve(KEY, 10);
    expect(reservation.waitedMs).toBe(60_000);
    expect(clock.currentTime).toBe(60_000);
  });
});
