import { describe, expect, it } from 'vitest';
import { createTraceBuilder } from '../trace/index.js';
import { createFakeClock } from '../test/clock.js';
import { createFakeTransport } from '../test/fake-transport.js';
import type { ScriptedResponse } from '../test/fake-transport.js';
import { createLlmClient } from './client.js';
import { LlmParseError, ProviderUnavailableError, RateLimitError } from './errors.js';
import { loadProviderProfiles } from './profiles.js';
import type { JsonSchemaSpec, TransportResponse } from './types.js';
import type { RateLimiter, Reservation } from './rate-limiter.js';

// A controllable RateLimiter double, isolating client.ts's own accounting logic from
// the pacer's own already-tested behavior (see rate-limiter.test.ts).
function fakeLimiter(waitedMs = 0): { limiter: RateLimiter; retryAfterCalls: number[] } {
  const retryAfterCalls: number[] = [];
  const reservation: Reservation = { waitedMs, commit: () => {}, release: () => {} };
  return {
    limiter: {
      reserve: () => Promise.resolve(reservation),
      noteHeaders: () => {},
      noteRetryAfter: (_key, seconds) => {
        retryAfterCalls.push(seconds);
      },
    },
    retryAfterCalls,
  };
}

function okResponse(overrides: Partial<TransportResponse> = {}): TransportResponse {
  return {
    status: 200,
    headers: {},
    content: JSON.stringify({ ok: true }),
    finishReason: 'stop',
    usage: { promptTokens: 500, completionTokens: 20, cachedPromptTokens: 0, reasoningTokens: 5 },
    ...overrides,
  };
}

interface Ok {
  ok: boolean;
}

function isOkShape(raw: unknown): raw is Ok {
  return typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>).ok === 'boolean';
}

const OK_SCHEMA: JsonSchemaSpec<Ok> = {
  name: 'test_schema',
  jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  validate: (raw) => (isOkShape(raw) ? { ok: true, value: raw } : { ok: false, error: 'missing "ok" field' }),
};

// Owns clock + transport creation together, so a scripted latencyMs actually reaches the
// same clock the client measures against (a real bug the first draft of this file had).
function setup(opts: { responses?: ScriptedResponse[]; waitedMs?: number } = {}) {
  const clock = createFakeClock();
  const transport = createFakeTransport('groq', opts.responses ?? [{ response: okResponse() }], clock);
  const { limiter, retryAfterCalls } = fakeLimiter(opts.waitedMs);
  const profiles = loadProviderProfiles({});
  const client = createLlmClient({ transports: { groq: transport }, profiles, limiter, clock });
  const builder = createTraceBuilder({ clock });
  const stage = builder.stage('grade-context');
  return { clock, transport, builder, stage, client, retryAfterCalls };
}

const BASE_REQUEST = {
  purpose: 'context-grader' as const,
  promptId: 'context-grader',
  promptVersion: 'v1',
  messages: [{ role: 'user' as const, content: 'q' }],
};

describe('createLlmClient / chatJson', () => {
  it('takes token counts from usage, never from the estimated request size', async () => {
    const { client, stage } = setup();
    const result = await client.chatJson({
      ...BASE_REQUEST,
      stage,
      messages: [{ role: 'user', content: 'hi' }], // trivially short — usage below proves it's ignored
      schema: OK_SCHEMA,
    });

    expect(result.value).toEqual({ ok: true });
    const [call] = result.calls;
    expect(call?.inputTokens).toBe(500);
    expect(call?.outputTokens).toBe(20);
  });

  it('retries exactly once on invalid JSON and records both attempts in the trace', async () => {
    const { client, stage, builder } = setup({
      responses: [{ response: okResponse({ content: 'not json' }) }, { response: okResponse() }],
    });

    const result = await client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA });

    expect(result.attempts).toBe(2);
    expect(result.calls).toHaveLength(2); // spent tokens from the failed attempt must not vanish
    expect(builder.build({ cache: 'bypass' }).stages[0]?.llmCalls).toHaveLength(2);
  });

  it('retries exactly once on schema validation failure', async () => {
    const { client, stage } = setup({
      responses: [{ response: okResponse({ content: JSON.stringify({ wrong: true }) }) }, { response: okResponse() }],
    });

    const result = await client.chatJson({
      ...BASE_REQUEST,
      purpose: 'answer-grader',
      promptId: 'answer-grader',
      stage,
      schema: OK_SCHEMA,
    });

    expect(result.attempts).toBe(2);
    expect(result.value).toEqual({ ok: true });
  });

  it('throws LlmParseError after two invalid responses, but both still land in the trace', async () => {
    const { client, stage, builder } = setup({
      responses: [
        { response: okResponse({ content: 'not json' }) },
        { response: okResponse({ content: 'still not json' }) },
      ],
    });

    await expect(client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA })).rejects.toThrow(LlmParseError);

    expect(builder.build({ cache: 'bypass' }).stages[0]?.llmCalls).toHaveLength(2);
  });

  it('keeps rate-limit wait time separate from provider latency', async () => {
    const { client, stage } = setup({
      responses: [{ response: okResponse(), latencyMs: 120 }],
      waitedMs: 5000,
    });

    const result = await client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA });

    expect(result.latencyMs).toBe(120);
    expect(result.rateLimitWaitMs).toBe(5000);
  });

  it('sends reasoning_effort per ADR 0003: low for graders, medium for the generator', async () => {
    const { client, stage, transport } = setup({
      responses: [{ response: okResponse() }, { response: okResponse() }],
    });

    await client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA });
    await client.chat({ ...BASE_REQUEST, purpose: 'generator', promptId: 'generator', stage });

    const [first, second] = transport.requests;
    expect(first?.reasoningEffort).toBe('low');
    expect(second?.reasoningEffort).toBe('medium');
  });

  it('passes the strict json_schema request shape through to the transport', async () => {
    const { client, stage, transport } = setup();

    await client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA });

    expect(transport.requests[0]?.jsonSchema).toEqual({
      name: 'test_schema',
      strict: true,
      schema: OK_SCHEMA.jsonSchema,
    });
  });

  it('records prompt versions on the stage', async () => {
    const { client, stage, builder } = setup();

    await client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA });

    expect(builder.build({ cache: 'bypass' }).promptVersions).toEqual({ 'context-grader': 'v1' });
  });

  it('releases and retries on 429, calling noteRetryAfter with the header value', async () => {
    const { client, stage, retryAfterCalls, builder } = setup({
      responses: [
        { response: { status: 429, headers: { 'retry-after': '2' }, content: null, finishReason: null, usage: null } },
        { response: okResponse() },
      ],
    });

    const result = await client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA });

    expect(result.value).toEqual({ ok: true });
    expect(retryAfterCalls).toEqual([2]);
    // The 429 attempt spent real time and must still show up in the trace, at zero cost.
    const calls = builder.build({ cache: 'bypass' }).stages[0]?.llmCalls ?? [];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, listPriceUsd: 0 });
  });

  it('throws RateLimitError after two consecutive 429s', async () => {
    const response: TransportResponse = {
      status: 429,
      headers: { 'retry-after': '1' },
      content: null,
      finishReason: null,
      usage: null,
    };
    const { client, stage } = setup({ responses: [{ response }, { response }] });

    await expect(client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA })).rejects.toThrow(RateLimitError);
  });

  it('throws ProviderUnavailableError when a response has no usage', async () => {
    const { client, stage } = setup({
      responses: [{ response: { status: 200, headers: {}, content: '{}', finishReason: 'stop', usage: null } }],
    });

    await expect(client.chatJson({ ...BASE_REQUEST, stage, schema: OK_SCHEMA })).rejects.toThrow(
      ProviderUnavailableError,
    );
  });
});

describe('createLlmClient / chat', () => {
  it('returns raw content on a successful single attempt', async () => {
    const { client, stage } = setup({
      responses: [{ response: okResponse({ content: 'a plain answer' }) }],
    });

    const result = await client.chat({ ...BASE_REQUEST, purpose: 'generator', promptId: 'generator', stage });

    expect(result.value).toBe('a plain answer');
    expect(result.attempts).toBe(1);
  });
});

describe('loadProviderProfiles', () => {
  it('never throws on an empty environment, and reports providers as keyless', () => {
    const profiles = loadProviderProfiles({});
    expect(profiles.groq.apiKey).toBeNull();
    expect(profiles.gemini.apiKey).toBeNull();
    expect(profiles.groq.modelFor('generator')).toBe('openai/gpt-oss-120b');
    expect(profiles.groq.modelFor('context-grader')).toBe('openai/gpt-oss-20b');
  });

  it('never constructs a real transport for a provider with no configured API key', async () => {
    const profiles = loadProviderProfiles({});
    const client = createLlmClient({
      transports: {}, // no transport wired up — mirrors "no key, so no transport was created"
      profiles,
      limiter: fakeLimiter().limiter,
    });

    await expect(
      client.chat({ ...BASE_REQUEST, purpose: 'generator', promptId: 'generator', stage: createTraceBuilder().stage('x') }),
    ).rejects.toThrow(ProviderUnavailableError);
  });
});
