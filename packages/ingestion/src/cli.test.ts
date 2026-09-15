import { describe, expect, it } from 'vitest';
import { buildProgram } from './cli.js';

describe('ingestion CLI', () => {
  it('requires --corpus', () => {
    const program = buildProgram().exitOverride();
    expect(() => program.parse(['node', 'cli.js'])).toThrow();
  });

  it('parses --corpus', () => {
    const program = buildProgram().exitOverride();
    program.parse(['node', 'cli.js', '--corpus', 'kubernetes']);
    expect(program.opts().corpus).toBe('kubernetes');
  });
});
