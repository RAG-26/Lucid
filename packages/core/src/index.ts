// Real RAG stages land here later; assertNever gives correction/routing exhaustive branching.
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

export * from './types.js';
