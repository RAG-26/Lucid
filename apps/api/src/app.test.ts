import { describe, expect, it } from 'vitest';
import { buildHealthResponse } from './app.js';

describe('buildHealthResponse', () => {
  it('reports ok with an ISO timestamp', () => {
    const health = buildHealthResponse();
    expect(health.status).toBe('ok');
    expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
  });
});
