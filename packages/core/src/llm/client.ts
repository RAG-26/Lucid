import type { LlmCall } from '../types.js';
import type { Clock } from '../trace/clock.js';
import { systemClock } from '../trace/clock.js';
import { LlmParseError, ProviderUnavailableError, RateLimitError } from './errors.js';
import { listPriceUsdFor } from './pricing.js';
import { providerForPurpose } from './profiles.js';
import type { ProviderProfiles } from './profiles.js';
import type { RateLimiter } from './rate-limiter.js';
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ChatTransport,
  JsonSchemaSpec,
  LlmClient,
  ProviderName,
} from './types.js';

// One real attempt + one retry on a parse failure or a 429 — a single shared budget,
// not two independent ones, since proactive pacing should make 429s rare in practice.
const MAX_ATTEMPTS = 2;

function estimateTokens(messages: ChatMessage[], maxOutputTokens: number | undefined): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4) + (maxOutputTokens ?? 512);
}

function zeroLlmCall(provider: ProviderName, model: string): LlmCall {
  return { provider, model, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, listPriceUsd: 0 };
}

function usageLlmCall(
  provider: ProviderName,
  model: string,
  usage: { promptTokens: number; completionTokens: number; cachedPromptTokens: number },
): LlmCall {
  return {
    provider,
    model,
    inputTokens: usage.promptTokens,
    cachedInputTokens: usage.cachedPromptTokens,
    outputTokens: usage.completionTokens,
    listPriceUsd: listPriceUsdFor(model, {
      inputTokens: usage.promptTokens,
      cachedInputTokens: usage.cachedPromptTokens,
      outputTokens: usage.completionTokens,
    }),
  };
}

export function createLlmClient(deps: {
  transports: Partial<Record<ProviderName, ChatTransport>>;
  profiles: ProviderProfiles;
  limiter: RateLimiter;
  clock?: Clock;
}): LlmClient {
  const clock = deps.clock ?? systemClock;

  async function call<T>(req: ChatRequest, schema?: JsonSchemaSpec<T>): Promise<ChatResult<T>> {
    const provider = providerForPurpose(req.purpose);
    const profile = deps.profiles[provider];
    const transport = deps.transports[provider];
    if (!transport) {
      throw new ProviderUnavailableError(provider, 0);
    }

    const model = profile.modelFor(req.purpose);
    const reasoningEffort = profile.reasoningEffortFor(req.purpose);

    let totalLatencyMs = 0;
    let totalRateLimitWaitMs = 0;
    const calls: LlmCall[] = [];
    let lastError: string | undefined;

    // Records both onto the trace stage AND into this call's own result — every attempt,
    // successful or not, so spent tokens never vanish from either (CLAUDE.md invariant #2).
    function record(llmCall: LlmCall, timing: { latencyMs: number; rateLimitWaitMs: number }): void {
      calls.push(llmCall);
      req.stage.recordLlmCall(llmCall, timing);
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const messages: ChatMessage[] =
        lastError === undefined
          ? req.messages
          : [
              ...req.messages,
              {
                role: 'user',
                content: `Your previous response was invalid: ${lastError}. Respond again, following the schema exactly.`,
              },
            ];

      const estimatedTokens = estimateTokens(messages, req.maxOutputTokens);
      const reservation = await deps.limiter.reserve({ provider, model }, estimatedTokens);
      const attemptWaitMs = reservation.waitedMs;
      totalRateLimitWaitMs += attemptWaitMs;

      const startedAt = clock.now();
      const response = await transport.send({
        model,
        messages,
        maxOutputTokens: req.maxOutputTokens,
        reasoningEffort,
        jsonSchema: schema ? { name: schema.name, strict: true, schema: schema.jsonSchema } : undefined,
        signal: req.signal,
      });
      const attemptLatencyMs = clock.now() - startedAt;
      totalLatencyMs += attemptLatencyMs;
      const timing = { latencyMs: attemptLatencyMs, rateLimitWaitMs: attemptWaitMs };

      deps.limiter.noteHeaders({ provider, model }, response.headers);

      if (response.status === 429) {
        reservation.release();
        const retryAfter = Number(response.headers['retry-after'] ?? '1');
        deps.limiter.noteRetryAfter({ provider, model }, retryAfter);
        record(zeroLlmCall(provider, model), timing);
        if (attempt === MAX_ATTEMPTS) {
          throw new RateLimitError(provider, retryAfter * 1000);
        }
        lastError = 'the provider returned 429 (rate limited)';
        continue;
      }

      if (!response.usage) {
        reservation.release();
        record(zeroLlmCall(provider, model), timing);
        throw new ProviderUnavailableError(provider, response.status);
      }

      reservation.commit(response.usage.promptTokens + response.usage.completionTokens);
      record(usageLlmCall(provider, model, response.usage), timing);
      req.stage.recordPromptVersion(req.promptId, req.promptVersion);

      if (!schema) {
        return {
          value: response.content as T,
          attempts: attempt,
          latencyMs: totalLatencyMs,
          rateLimitWaitMs: totalRateLimitWaitMs,
          calls,
        };
      }

      let parsed: unknown;
      try {
        parsed = response.content ? JSON.parse(response.content) : undefined;
      } catch {
        lastError = 'response was not valid JSON';
        if (attempt === MAX_ATTEMPTS) {
          throw new LlmParseError(schema.name, response.content, lastError);
        }
        continue;
      }

      const validated = schema.validate(parsed);
      if (!validated.ok) {
        lastError = validated.error;
        if (attempt === MAX_ATTEMPTS) {
          throw new LlmParseError(schema.name, response.content, lastError);
        }
        continue;
      }

      return {
        value: validated.value,
        attempts: attempt,
        latencyMs: totalLatencyMs,
        rateLimitWaitMs: totalRateLimitWaitMs,
        calls,
      };
    }

    // Unreachable: every loop iteration returns or throws by MAX_ATTEMPTS. Kept so
    // TypeScript can see every path returns.
    throw new LlmParseError(schema?.name ?? 'unknown', null, lastError ?? 'exhausted retries');
  }

  return {
    chat: (req) => call<string>(req),
    chatJson: (req) => call(req, req.schema),
  };
}
