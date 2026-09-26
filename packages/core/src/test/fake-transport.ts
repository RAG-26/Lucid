import type { ChatTransport, ProviderName, TransportRequest, TransportResponse } from '../llm/types.js';
import type { FakeClock } from './clock.js';

export interface ScriptedResponse {
  response?: TransportResponse;
  error?: Error;
  // Simulated round-trip time: advances the shared FakeClock before resolving, so tests can
  // assert exact latencyMs values without waiting in real time.
  latencyMs?: number;
}

export interface FakeTransport extends ChatTransport {
  readonly requests: TransportRequest[];
  readonly callCount: number;
  push(...responses: ScriptedResponse[]): void;
}

// Scripted double for ChatTransport — records every request so tests can assert on shape
// (e.g. "no `stream` field", "exactly one call for k chunks") and throws if the script
// runs dry, so an unexpected extra call fails loudly instead of hanging.
export function createFakeTransport(
  provider: ProviderName,
  scripted: ScriptedResponse[] = [],
  clock?: FakeClock,
): FakeTransport {
  const queue = [...scripted];
  const requests: TransportRequest[] = [];

  return {
    provider,
    requests,
    get callCount() {
      return requests.length;
    },
    push(...responses: ScriptedResponse[]) {
      queue.push(...responses);
    },
    send(req: TransportRequest): Promise<TransportResponse> {
      requests.push(req);
      const next = queue.shift();
      if (!next) {
        return Promise.reject(
          new Error(`FakeTransport for "${provider}" ran out of scripted responses (call ${requests.length})`),
        );
      }
      if (next.latencyMs) clock?.advance(next.latencyMs);
      if (next.error) return Promise.reject(next.error);
      return Promise.resolve(next.response!);
    },
  };
}
