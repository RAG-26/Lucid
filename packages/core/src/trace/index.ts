import type { CacheStatus, EmbedCall, LlmCall, Trace, TraceStage } from '../types.js';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

export * from './clock.js';

export interface StageTiming {
  latencyMs: number;
  rateLimitWaitMs: number;
}

export interface StageRecorder {
  readonly name: string;
  recordLlmCall(call: LlmCall, timing: StageTiming): void;
  recordEmbedCall(call: EmbedCall): void;
  recordPromptVersion(promptId: string, version: string): void;
  setDecision(decision: string, reason: string): void;
}

export interface TraceBuilder {
  stage(name: string): StageRecorder;
  build(opts: { cache: CacheStatus; corpusVersion?: string }): Trace;
}

class StageRecorderImpl implements StageRecorder {
  latencyMs = 0;
  rateLimitWaitMs = 0;
  llmCalls: LlmCall[] = [];
  embedCalls: EmbedCall[] = [];
  decision = '';
  reason = '';
  promptVersions: Record<string, string> = {};

  constructor(readonly name: string) {}

  recordLlmCall(call: LlmCall, timing: StageTiming): void {
    this.llmCalls.push(call);
    this.latencyMs += timing.latencyMs;
    this.rateLimitWaitMs += timing.rateLimitWaitMs;
  }

  recordEmbedCall(call: EmbedCall): void {
    this.embedCalls.push(call);
    this.latencyMs += call.latencyMs;
  }

  recordPromptVersion(promptId: string, version: string): void {
    this.promptVersions[promptId] = version;
  }

  setDecision(decision: string, reason: string): void {
    this.decision = decision;
    this.reason = reason;
  }

  toTraceStage(): TraceStage {
    return {
      name: this.name,
      latencyMs: this.latencyMs,
      rateLimitWaitMs: this.rateLimitWaitMs,
      decision: this.decision,
      reason: this.reason,
      llmCalls: this.llmCalls,
      embedCalls: this.embedCalls,
    };
  }
}

export function createTraceBuilder(opts: { corpusVersion?: string; clock?: Clock } = {}): TraceBuilder {
  const clock = opts.clock ?? systemClock;
  const stages: StageRecorderImpl[] = [];
  const startedAt = clock.now();

  return {
    stage(name: string): StageRecorder {
      const recorder = new StageRecorderImpl(name);
      stages.push(recorder);
      return recorder;
    },

    build(buildOpts: { cache: CacheStatus; corpusVersion?: string }): Trace {
      const traceStages = stages.map((s) => s.toTraceStage());

      // Sum of input + output only — cachedInputTokens is a pricing-only subset of
      // inputTokens, not an addition (providers report prompt_tokens inclusive of it).
      const totalTokens = traceStages.reduce(
        (sum, stage) =>
          sum + stage.llmCalls.reduce((callSum, call) => callSum + call.inputTokens + call.outputTokens, 0),
        0,
      );
      const totalListPriceUsd = traceStages.reduce(
        (sum, stage) => sum + stage.llmCalls.reduce((callSum, call) => callSum + call.listPriceUsd, 0),
        0,
      );

      const promptVersions: Record<string, string> = {};
      for (const s of stages) Object.assign(promptVersions, s.promptVersions);

      return {
        stages: traceStages,
        cache: buildOpts.cache,
        totalLatencyMs: clock.now() - startedAt,
        totalTokens,
        totalListPriceUsd,
        promptVersions,
        corpusVersion: buildOpts.corpusVersion ?? opts.corpusVersion ?? 'unknown',
      };
    },
  };
}
