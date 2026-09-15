// Shared contracts (CLAUDE.md). Proposed — needs Navnita's review before it's final.

export interface RequestContext {
  requestId: string;
  scope: string; // "public" in V1; becomes the tenant id in V2 (see the RLS seam in CLAUDE.md)
}

export type Corpus = 'kubernetes' | 'docker';

export interface Chunk {
  id: string; // opaque; the id scheme itself belongs to the DB schema (ADR 0001)
  documentId: string;
  corpus: Corpus;
  title: string;
  headingPath: string[]; // e.g. ["Concepts", "Storage", "Volumes", "hostPath"]
  url: string;
  content: string;
  tokenCount: number;
}

export interface RetrievedChunk extends Chunk {
  score: number;
}

export interface Citation {
  index: number; // the [n] shown in the answer text, 1-indexed into the chunks passed in
  chunkId: string;
}

export interface GenerationResult {
  answer: string;
  citations: Citation[];
}

export interface ContextGradeResult {
  relevant: boolean;
  relevantChunkIds: string[];
}

export interface AnswerGradeResult {
  grounded: boolean;
  unsupportedClaims: string[];
  reason: string;
}

export interface RoutingDecision {
  corpora: Corpus[]; // all corpora in V1; a real classifier narrows this in V2
}

export type CacheLookupResult = { status: 'hit'; result: PipelineResult } | { status: 'miss' };

export interface Retriever {
  retrieve(ctx: RequestContext, query: string, k: number): Promise<RetrievedChunk[]>;
}

export interface Generator {
  generate(
    ctx: RequestContext,
    question: string,
    chunks: RetrievedChunk[],
    feedback?: string[],
  ): Promise<GenerationResult>;
}

export interface ContextGrader {
  grade(
    ctx: RequestContext,
    question: string,
    chunks: RetrievedChunk[],
  ): Promise<ContextGradeResult>;
}

export interface QueryRewriter {
  rewrite(ctx: RequestContext, question: string): Promise<string>;
}

export interface AnswerGrader {
  grade(
    ctx: RequestContext,
    question: string,
    generation: GenerationResult,
    chunks: RetrievedChunk[],
  ): Promise<AnswerGradeResult>;
}

export interface SemanticCache {
  lookup(ctx: RequestContext, question: string): Promise<CacheLookupResult>;
  store(ctx: RequestContext, question: string, result: PipelineResult): Promise<void>;
}

export interface QueryRouter {
  route(ctx: RequestContext, question: string): Promise<RoutingDecision>;
}

export interface Embedder {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export type PipelineStatus = 'answered' | 'abstained';

export interface PipelineResult {
  status: PipelineStatus;
  answer: string;
  citations: Citation[]; // supporting citations; empty when abstained
  nearestChunks: RetrievedChunk[]; // shown on abstention as "closest but insufficient"; empty otherwise
  trace: Trace;
}

export type CacheStatus = 'hit' | 'miss' | 'bypass';

export interface LlmCall {
  provider: 'groq' | 'gemini';
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  listPriceUsd: number;
}

export interface EmbedCall {
  model: string;
  revision: string;
  dtype: string;
  inputCount: number;
  tokens: number;
  latencyMs: number;
}

export interface TraceStage {
  name: string;
  latencyMs: number;
  rateLimitWaitMs: number;
  decision: string;
  reason: string;
  llmCalls: LlmCall[];
  embedCalls: EmbedCall[];
}

export interface Trace {
  stages: TraceStage[];
  cache: CacheStatus;
  totalLatencyMs: number;
  totalTokens: number; // sum of every llmCalls[] token field across stages — never estimated (ADR 0003)
  totalListPriceUsd: number;
  promptVersions: Record<string, string>;
  corpusVersion: string;
}
