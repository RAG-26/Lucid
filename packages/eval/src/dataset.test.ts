import { describe, expect, it } from 'vitest';
import { loadQuestions } from './dataset.js';

describe('loadQuestions', () => {
  const questions = loadQuestions('datasets/questions.jsonl');

  it('parses every line', () => {
    expect(questions.length).toBeGreaterThanOrEqual(10);
  });

  it('has unique ids', () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every unanswerable question a reason', () => {
    for (const q of questions) {
      if (!q.answerable) expect(q.unanswerableReason).toBeDefined();
    }
  });
});
