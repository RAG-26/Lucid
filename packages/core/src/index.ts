// Real RAG logic (types, llm, embeddings, db, retrieval, generation, correction, cache,
// routing, prompts, pipeline) lands here in later PRs per CLAUDE.md's repo layout.
// For now, one small helper that's genuinely useful once those stages exist: correction and
// routing both need to exhaustively branch over a closed set of cases, and forgetting a case
// should be a compile error, not a silent runtime fallthrough.
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
