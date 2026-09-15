import { readFileSync } from 'node:fs';
import { questionSchema, type Question } from './schema.js';

export function loadQuestions(path: string): Question[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      const result = questionSchema.safeParse(JSON.parse(line));
      if (!result.success) {
        throw new Error(`${path}:${i + 1}: ${result.error.message}`);
      }
      return result.data;
    });
}
