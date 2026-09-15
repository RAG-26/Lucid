# ADR 0003: Providers and quotas

- **Status:** Proposed
- **Owner:** Dhananjay
- **Reviewers:** Navnita
- **Date:** 2026-09-15

## Context

Lucid runs on free-tier providers only: Groq for generation and grading, Google
Gemini for the offline eval judge, and local embeddings (see CLAUDE.md's
Models table). This ADR settles two open questions Navnita raised in
[ADR 0001](0001-chunking-and-embeddings.md): which tokenizer the trace uses for
"tokens," and whether Groq's `reasoning_effort` can help gpt-oss calls stay
under the 8K-tokens/minute budget.

## Decision

### Models and the judge/grader split

Generation and grading run on Groq's `openai/gpt-oss-120b` and
`openai/gpt-oss-20b`; the eval judge runs on Google's `gemini-3.8-flash`. The
judge must stay a different model family from the grader, so the corrective
pipeline isn't scored by a model that already approved its own answers (full
reasoning: CLAUDE.md).

### Reasoning effort

Groq's gpt-oss models accept `reasoning_effort: "low" | "medium" | "high"`
(verified against Groq's docs, 2026-09-15). Defaults:

| Call           | `reasoning_effort` |
| -------------- | ------------------ |
| Context grader | low                |
| Answer grader  | low                |
| Query rewriter | low                |
| Generator      | medium             |

Grading is a closed relevance/groundedness judgment — low effort is enough,
and it keeps the shared per-minute budget for context tokens rather than
reasoning tokens. Generation gets medium since answer quality matters more
and it runs at most twice per query, versus the grader's higher call volume.
Groq doesn't document how reasoning tokens are billed for these models; the
token-accounting rule below doesn't depend on knowing that.

### Token accounting (trace contract)

Three different "tokens" appear in this project. The trace keeps them
distinct instead of conflating them:

| Purpose                                              | Tokenizer                             | Source                                         |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Embedding truncation, chunk sizing                   | nomic (`bert-base-uncased` WordPiece) | computed by `core/embeddings`                  |
| Pre-flight context-size estimates (sweeps, planning) | o200k                                 | estimated                                      |
| Every `llmCalls[]` entry in the trace                | whatever Groq/Gemini return           | the provider's own `usage`, never re-estimated |

`core/llm` always reads token counts from the provider's response and records
those as-is. Estimation is a planning tool only — it never substitutes for
actual usage in a trace or an eval result.

### Rate-limit pacing

`core/llm` paces requests per provider and records wait time separately
(`rateLimitWaitMs`) from latency, per CLAUDE.md's invariant #2.

## Consequences

- Changing a model, a `reasoning_effort` default, or the token-accounting rule
  invalidates eval results (`Eval-Impact: rerun required`).
- If Groq later documents reasoning-token billing differently, only the
  effort defaults need revisiting — the "trust `usage`" rule stays put.

## Alternatives considered

| Option                                    | Why not                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| High `reasoning_effort` everywhere        | Grading and rewriting don't need deep reasoning, and it burns the shared budget fastest on the highest-call-volume stages |
| Estimate tokens client-side for the trace | Simpler before a call happens, but drifts from what's actually billed and rate-limited                                    |

## Open questions for joint review

- Confirm these `reasoning_effort` defaults once real dev-split runs show
  actual token and latency numbers per stage.
