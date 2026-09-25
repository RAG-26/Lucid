import OpenAI, { APIError } from 'openai';
import { MissingApiKeyError } from './errors.js';
import type { ProviderProfile } from './profiles.js';
import type { ChatTransport, TransportRequest, TransportResponse, TransportUsage } from './types.js';

// The only file in this package that imports `openai` (CLAUDE.md invariant #2) — everything
// else talks to the ChatTransport seam, which is what makes the rest of core/llm testable offline.

function toHeaderRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

interface HttpErrorLike {
  status?: number;
  headers?: Headers;
}

// A type predicate with our own declared shape, rather than trusting whatever `instanceof`
// narrowing resolves to for the SDK's own generic class across its dual CJS/ESM type entry points.
function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  return error instanceof APIError;
}

function toUsage(raw: OpenAI.CompletionUsage | undefined): TransportUsage | null {
  if (!raw) return null;
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    cachedPromptTokens: raw.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: raw.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

export function createOpenAiTransport(profile: ProviderProfile): ChatTransport {
  if (!profile.apiKey) {
    throw new MissingApiKeyError(profile.provider);
  }

  const client = new OpenAI({ apiKey: profile.apiKey, baseURL: profile.baseURL });

  return {
    provider: profile.provider,

    async send(req: TransportRequest): Promise<TransportResponse> {
      const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: req.model,
        messages: req.messages,
        max_completion_tokens: req.maxOutputTokens,
        ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
        ...(req.jsonSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: req.jsonSchema.name,
                  strict: true,
                  schema: req.jsonSchema.schema,
                },
              },
            }
          : {}),
      };

      try {
        const { data, response } = await client.chat.completions
          .create(body, { signal: req.signal })
          .withResponse();

        const choice = data.choices[0];
        return {
          status: response.status,
          headers: toHeaderRecord(response.headers),
          content: choice?.message.content ?? null,
          finishReason: choice?.finish_reason ?? null,
          usage: toUsage(data.usage),
        };
      } catch (error) {
        if (isHttpErrorLike(error)) {
          const status = error.status ?? 500;
          const headers = error.headers ? toHeaderRecord(error.headers) : {};
          return { status, headers, content: null, finishReason: null, usage: null };
        }
        throw error;
      }
    },
  };
}
