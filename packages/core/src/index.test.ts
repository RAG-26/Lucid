import { describe, expect, it } from 'vitest';
import { assertNever } from './index.js';

describe('assertNever', () => {
  it('throws with the unhandled value in the message', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(/unexpected/);
  });
});
