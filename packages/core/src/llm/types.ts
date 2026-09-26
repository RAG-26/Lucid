import type { LlmCall } from '../types.js';
import type { StageRecorder } from '../trace/index.js';

export type ProviderName = LlmCall['provider'];

// eval-judge maps to Gemini (Week 3); the other four run on Groq (ADR 0003).
export type LlmPurpose = 'context-grader' | 'answer-grader' | 'query-rewriter' | 'generator' | 'eval-judge';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface QuotaLimits {
  rpm: number;
  tpm: number;
  rpd: number;
  tpd: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// --- The offline seam: everything below is provider-shaped but SDK-free. ---
// Only llm/transport.ts translates between this and the `openai` package.

export interface JsonSchemaFormat {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
}

export interface TransportRequest {
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  jsonSchema?: JsonSchemaFormat;
  signal?: AbortSignal;
}

export interface TransportUsage {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  reasoningTokens: number;
}

export interface TransportResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  content: string | null;
  finishReason: string | null;
  usage: TransportUsage | null;
}

export interface ChatTransport {
  readonly provider: ProviderName;
  send(req: TransportRequest): Promise<TransportResponse>;
}

// --- The client's public request/result shapes. ---

export interface JsonSchemaSpec<T> {
  name: string;
  jsonSchema: Record<string, unknown>;
  validate: (raw: unknown) => { ok: true; value: T } | { ok: false; error: string };
}

interface ChatRequestBase {
  purpose: LlmPurpose;
  // Required, not optional: there is no code path that makes a call without a place
  // to record it (CLAUDE.md invariant #2).
  stage: StageRecorder;
  promptId: string;
  promptVersion: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export type ChatRequest = ChatRequestBase;

export interface ChatJsonRequest<T> extends ChatRequestBase {
  schema: JsonSchemaSpec<T>;
}

export interface ChatResult<T> {
  value: T;
  attempts: number;
  latencyMs: number;
  rateLimitWaitMs: number;
  calls: LlmCall[];
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResult<string>>;
  chatJson<T>(req: ChatJsonRequest<T>): Promise<ChatResult<T>>;
}
