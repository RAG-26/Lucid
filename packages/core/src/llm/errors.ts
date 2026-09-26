export class LlmError extends Error {}

export class MissingApiKeyError extends LlmError {
  constructor(provider: string) {
    super(`No API key configured for provider "${provider}"`);
    this.name = 'MissingApiKeyError';
  }
}

export class RateLimitError extends LlmError {
  constructor(
    public readonly provider: string,
    public readonly retryAfterMs: number,
  ) {
    super(`${provider} rate limit hit; retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}

export class QuotaExhaustedError extends LlmError {
  constructor(
    public readonly provider: string,
    public readonly model: string,
    public readonly kind: 'rpd' | 'tpd',
    public readonly resetAt: number,
  ) {
    super(
      `${provider}/${model} exhausted its daily ${kind.toUpperCase()} quota; resets at ${new Date(resetAt).toISOString()}`,
    );
    this.name = 'QuotaExhaustedError';
  }
}

export class LlmParseError extends LlmError {
  constructor(
    public readonly schemaName: string,
    public readonly rawContent: string | null,
    public readonly reason: string,
  ) {
    super(`Failed to parse "${schemaName}" response: ${reason}`);
    this.name = 'LlmParseError';
  }
}

export class ProviderUnavailableError extends LlmError {
  constructor(
    public readonly provider: string,
    public readonly status: number,
  ) {
    super(`${provider} returned an unusable response (status ${status})`);
    this.name = 'ProviderUnavailableError';
  }
}
