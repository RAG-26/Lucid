import type { Clock } from '../trace/clock.js';
import { systemClock } from '../trace/clock.js';
import { QuotaExhaustedError } from './errors.js';
import type { QuotaLimits } from './types.js';

export interface RateLimitKey {
  provider: string;
  model: string;
}

export interface Reservation {
  waitedMs: number;
  // Rewrites the provisional estimate with the provider's real usage — an over-estimate
  // frees budget immediately, an under-estimate borrows against the current window.
  commit(actualTokens: number): void;
  // The call never happened (e.g. a 429): undo the provisional reservation entirely.
  release(): void;
}

export interface RateLimiter {
  reserve(key: RateLimitKey, estimatedTokens: number): Promise<Reservation>;
  noteHeaders(key: RateLimitKey, headers: Readonly<Record<string, string>>): void;
  noteRetryAfter(key: RateLimitKey, retryAfterSeconds: number): void;
}

interface TokenEvent {
  at: number;
  tokens: number;
}

interface HeaderRemaining {
  tokens: number;
  resetAt: number;
}

interface Bucket {
  requestTimes: number[];
  tokenEvents: TokenEvent[];
  dayRequests: number;
  dayTokens: number;
  dayResetAt: number;
  blockedUntil: number;
  headerRemaining: HeaderRemaining | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function bucketKey(key: RateLimitKey): string {
  return `${key.provider}:${key.model}`;
}

function createBucket(now: number): Bucket {
  return {
    requestTimes: [],
    tokenEvents: [],
    dayRequests: 0,
    dayTokens: 0,
    dayResetAt: now + DAY_MS,
    blockedUntil: 0,
    headerRemaining: null,
  };
}

// Groq's x-ratelimit-reset-* headers report durations like "2m30s" / "1s". Confirmed against
// a real response is a PR 2 (smoke command) job; falls back to 1s if the format doesn't match.
function parseGroqDuration(value: string | undefined): number {
  if (!value) return 1000;
  const match = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return 1000;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = match[2] ? Number(match[2]) : 0;
  return (minutes * 60 + seconds) * 1000;
}

export function createRateLimiter(deps: { limits: (key: RateLimitKey) => QuotaLimits; clock?: Clock }): RateLimiter {
  const clock = deps.clock ?? systemClock;
  const buckets = new Map<string, Bucket>();

  function getBucket(key: RateLimitKey): Bucket {
    const k = bucketKey(key);
    let bucket = buckets.get(k);
    const now = clock.now();
    if (!bucket) {
      bucket = createBucket(now);
      buckets.set(k, bucket);
    }
    if (now >= bucket.dayResetAt) {
      bucket.dayRequests = 0;
      bucket.dayTokens = 0;
      bucket.dayResetAt = now + DAY_MS;
      bucket.headerRemaining = null;
    }
    return bucket;
  }

  function pruneWindow(bucket: Bucket, now: number): void {
    bucket.requestTimes = bucket.requestTimes.filter((t) => now - t < MINUTE_MS);
    bucket.tokenEvents = bucket.tokenEvents.filter((e) => now - e.at < MINUTE_MS);
  }

  function msUntilRpmRoom(bucket: Bucket, limits: QuotaLimits, now: number): number {
    if (bucket.requestTimes.length < limits.rpm) return 0;
    const oldest = bucket.requestTimes[0];
    return Math.max(0, MINUTE_MS - (now - oldest));
  }

  function msUntilTpmRoom(bucket: Bucket, limits: QuotaLimits, now: number, estimatedTokens: number): number {
    const projected = bucket.tokenEvents.reduce((sum, e) => sum + e.tokens, 0) + estimatedTokens;
    if (projected <= limits.tpm) return 0;
    const oldest = bucket.tokenEvents[0];
    if (!oldest) return 0;
    return Math.max(0, MINUTE_MS - (now - oldest.at));
  }

  return {
    async reserve(key, estimatedTokens) {
      const limits = deps.limits(key);
      let waitedMs = 0;

      for (;;) {
        const now = clock.now();
        const bucket = getBucket(key);
        pruneWindow(bucket, now);

        if (bucket.dayRequests >= limits.rpd) {
          throw new QuotaExhaustedError(key.provider, key.model, 'rpd', bucket.dayResetAt);
        }
        if (bucket.dayTokens + estimatedTokens > limits.tpd) {
          throw new QuotaExhaustedError(key.provider, key.model, 'tpd', bucket.dayResetAt);
        }

        const waits = [
          Math.max(0, bucket.blockedUntil - now),
          msUntilRpmRoom(bucket, limits, now),
          msUntilTpmRoom(bucket, limits, now, estimatedTokens),
        ];
        // The provider's own reported headroom can be stricter than our local estimate
        // (a shared account, or console limits that differ from ADR 0003's defaults).
        if (bucket.headerRemaining && bucket.headerRemaining.tokens < estimatedTokens) {
          waits.push(Math.max(0, bucket.headerRemaining.resetAt - now));
        }

        const wait = Math.max(...waits);
        if (wait <= 0) break;
        waitedMs += wait;
        await clock.sleep(wait);
      }

      const now = clock.now();
      const bucket = getBucket(key);
      bucket.requestTimes.push(now);
      bucket.dayRequests += 1;
      bucket.dayTokens += estimatedTokens;
      const tokenEvent: TokenEvent = { at: now, tokens: estimatedTokens };
      bucket.tokenEvents.push(tokenEvent);

      let settled = false;
      return {
        waitedMs,
        commit(actualTokens: number) {
          if (settled) return;
          settled = true;
          bucket.dayTokens += actualTokens - estimatedTokens;
          tokenEvent.tokens = actualTokens;
        },
        release() {
          if (settled) return;
          settled = true;
          bucket.dayTokens -= estimatedTokens;
          bucket.dayRequests -= 1;
          const eventIdx = bucket.tokenEvents.indexOf(tokenEvent);
          if (eventIdx >= 0) bucket.tokenEvents.splice(eventIdx, 1);
          const reqIdx = bucket.requestTimes.lastIndexOf(now);
          if (reqIdx >= 0) bucket.requestTimes.splice(reqIdx, 1);
        },
      };
    },

    noteHeaders(key, headers) {
      const remainingTokens = headers['x-ratelimit-remaining-tokens'];
      if (remainingTokens === undefined) return;
      const bucket = getBucket(key);
      bucket.headerRemaining = {
        tokens: Number(remainingTokens),
        resetAt: clock.now() + parseGroqDuration(headers['x-ratelimit-reset-tokens']),
      };
    },

    noteRetryAfter(key, retryAfterSeconds) {
      const bucket = getBucket(key);
      bucket.blockedUntil = clock.now() + retryAfterSeconds * 1000;
    },
  };
}
