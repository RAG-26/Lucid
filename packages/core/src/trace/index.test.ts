import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../test/clock.js';
import { createTraceBuilder } from './index.js';
import type { LlmCall } from '../types.js';

function call(overrides: Partial<LlmCall> = {}): LlmCall {
  return { provider: 'groq', model: 'openai/gpt-oss-20b', inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, listPriceUsd: 0, ...overrides };
}

describe('createTraceBuilder', () => {
  it('sums input + output tokens and list price across every call in every stage', () => {
    const builder = createTraceBuilder();
    const stage1 = builder.stage('grade-context');
    stage1.recordLlmCall(call({ inputTokens: 100, outputTokens: 10, listPriceUsd: 0.01 }), {
      latencyMs: 0,
      rateLimitWaitMs: 0,
    });
    const stage2 = builder.stage('generate');
    stage2.recordLlmCall(call({ inputTokens: 200, outputTokens: 20, listPriceUsd: 0.02 }), {
      latencyMs: 0,
      rateLimitWaitMs: 0,
    });

    const trace = builder.build({ cache: 'miss' });

    expect(trace.totalTokens).toBe(100 + 10 + 200 + 20);
    expect(trace.totalListPriceUsd).toBeCloseTo(0.03, 6);
    expect(trace.stages).toHaveLength(2);
  });

  it('does not double-count cachedInputTokens (a subset of inputTokens, not an addition)', () => {
    const builder = createTraceBuilder();
    const stage = builder.stage('generate');
    stage.recordLlmCall(call({ inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 }), {
      latencyMs: 0,
      rateLimitWaitMs: 0,
    });

    const trace = builder.build({ cache: 'miss' });
    expect(trace.totalTokens).toBe(110); // 100 + 10, not 100 + 40 + 10
  });

  it('merges prompt versions recorded across different stages', () => {
    const builder = createTraceBuilder();
    builder.stage('grade-context').recordPromptVersion('context-grader', 'v1');
    builder.stage('generate').recordPromptVersion('generator', 'v2');

    const trace = builder.build({ cache: 'miss' });
    expect(trace.promptVersions).toEqual({ 'context-grader': 'v1', generator: 'v2' });
  });

  it('accumulates latency and rate-limit wait separately per stage', () => {
    const builder = createTraceBuilder();
    const stage = builder.stage('grade-context');
    stage.recordLlmCall(call(), { latencyMs: 100, rateLimitWaitMs: 50 });
    stage.recordLlmCall(call(), { latencyMs: 200, rateLimitWaitMs: 0 });
    stage.setDecision('relevant', 'two chunks matched');

    const [traceStage] = builder.build({ cache: 'hit' }).stages;
    expect(traceStage?.latencyMs).toBe(300);
    expect(traceStage?.rateLimitWaitMs).toBe(50);
    expect(traceStage?.decision).toBe('relevant');
    expect(traceStage?.reason).toBe('two chunks matched');
  });

  it('measures totalLatencyMs as wall-clock time from builder creation to build()', () => {
    const clock = createFakeClock();
    const builder = createTraceBuilder({ clock });
    clock.advance(250);
    const trace = builder.build({ cache: 'bypass' });
    expect(trace.totalLatencyMs).toBe(250);
  });

  it('defaults corpusVersion to "unknown" when none is given', () => {
    const trace = createTraceBuilder().build({ cache: 'bypass' });
    expect(trace.corpusVersion).toBe('unknown');
  });
});
