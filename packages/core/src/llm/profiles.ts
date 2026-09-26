import { z } from 'zod';
import type { LlmPurpose, ProviderName, QuotaLimits, ReasoningEffort } from './types.js';

// ADR 0003: low effort for graders/rewriter, medium for the generator. Gemini's
// reasoning-effort support through the OpenAI-compat layer is unconfirmed (Week 3 work).
const REASONING_EFFORT: Partial<Record<LlmPurpose, ReasoningEffort>> = {
  'context-grader': 'low',
  'answer-grader': 'low',
  'query-rewriter': 'low',
  generator: 'medium',
};

const PURPOSE_PROVIDER: Record<LlmPurpose, ProviderName> = {
  'context-grader': 'groq',
  'answer-grader': 'groq',
  'query-rewriter': 'groq',
  generator: 'groq',
  'eval-judge': 'gemini',
};

export function providerForPurpose(purpose: LlmPurpose): ProviderName {
  return PURPOSE_PROVIDER[purpose];
}

export interface ProviderProfile {
  readonly provider: ProviderName;
  readonly baseURL: string;
  readonly apiKey: string | null;
  readonly limits: QuotaLimits;
  modelFor(purpose: LlmPurpose): string;
  reasoningEffortFor(purpose: LlmPurpose): ReasoningEffort | undefined;
}

export interface ProviderProfiles {
  groq: ProviderProfile;
  gemini: ProviderProfile;
}

// Blank strings in `.env` (an unset key) should behave like the key being absent,
// so every field falls back to its documented default instead of failing validation.
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);

const numberEnv = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(fallback));

const stringEnv = (fallback: string) =>
  z.preprocess(blankToUndefined, z.string().min(1).default(fallback));

const apiKeyEnv = z.preprocess(blankToUndefined, z.string().min(1).optional());

const envSchema = z.object({
  GROQ_API_KEY: apiKeyEnv,
  GROQ_GENERATION_MODEL: stringEnv('openai/gpt-oss-120b'),
  GROQ_GRADER_MODEL: stringEnv('openai/gpt-oss-20b'),
  // Free-tier defaults per ADR 0003; overridable once the console confirms the account's actual limits.
  GROQ_RPM: numberEnv(30),
  GROQ_TPM: numberEnv(8000),
  GROQ_RPD: numberEnv(1000),
  GROQ_TPD: numberEnv(200000),
  GEMINI_API_KEY: apiKeyEnv,
  GEMINI_JUDGE_MODEL: stringEnv('gemini-3.8-flash'),
});

// Never throws on missing keys — `@lucid/core` must import cleanly with no secrets set
// (CI never calls providers), so unavailability is a value graders/tests can check, not a crash.
export function loadProviderProfiles(env: NodeJS.ProcessEnv = process.env): ProviderProfiles {
  const parsed = envSchema.parse(env);

  const groqLimits: QuotaLimits = {
    rpm: parsed.GROQ_RPM,
    tpm: parsed.GROQ_TPM,
    rpd: parsed.GROQ_RPD,
    tpd: parsed.GROQ_TPD,
  };

  const groq: ProviderProfile = {
    provider: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: parsed.GROQ_API_KEY ?? null,
    limits: groqLimits,
    modelFor: (purpose) => (purpose === 'generator' ? parsed.GROQ_GENERATION_MODEL : parsed.GROQ_GRADER_MODEL),
    reasoningEffortFor: (purpose) => REASONING_EFFORT[purpose],
  };

  const gemini: ProviderProfile = {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: parsed.GEMINI_API_KEY ?? null,
    // The judge runs offline in Week 3, outside the per-minute pacing that binds Groq.
    limits: { rpm: Infinity, tpm: Infinity, rpd: Infinity, tpd: Infinity },
    modelFor: () => parsed.GEMINI_JUDGE_MODEL,
    reasoningEffortFor: () => undefined,
  };

  return { groq, gemini };
}
