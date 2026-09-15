import { describe, expect, it } from 'vitest';
import { buildProgram } from './cli.js';

describe('eval CLI', () => {
  it('parses `run --config --split`', () => {
    const program = buildProgram().exitOverride();
    program.parse(['node', 'cli.js', 'run', '--config', 'baseline', '--split', 'dev']);
    const run = program.commands.find((c) => c.name() === 'run');
    expect(run?.opts()).toEqual({ config: 'baseline', split: 'dev' });
  });

  it('parses `judge --run`', () => {
    const program = buildProgram().exitOverride();
    program.parse(['node', 'cli.js', 'judge', '--run', 'abc123']);
    const judge = program.commands.find((c) => c.name() === 'judge');
    expect(judge?.opts()).toEqual({ run: 'abc123' });
  });

  it('requires --config and --split on run', () => {
    const program = buildProgram().exitOverride();
    expect(() => program.parse(['node', 'cli.js', 'run'])).toThrow();
  });
});
