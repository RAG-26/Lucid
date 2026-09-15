# ADR 0004: Abstention policy

- **Status:** Proposed
- **Owner:** Dhananjay
- **Reviewers:** Navnita
- **Date:** 2026-09-15

## Context

CLAUDE.md's invariant #5 says "unsupported" means not supported by the
retrieved chunks, regardless of real-world truth. This ADR defines exactly
what "grounded" means, how the bounded correction loop (1 rewrite, 1
regeneration max) resolves, and how a partially supported answer is handled —
left open in CLAUDE.md.

## Decision

### Grounded vs. not grounded

An answer is grounded only if every factual claim in it is supported by a
retrieved chunk it cites as `[n]`. One unsupported or wrongly cited claim
makes the whole answer not grounded — the pipeline's pass/fail decision has
no partial credit, even though the grader explains which claim failed.

### Why binary, not partial

A "70% grounded" answer can still state a hallucinated claim with the same
confidence as the rest, and abstention ("the docs don't cover this") doesn't
compose with "trust everything except this one part." Binary keeps the
decision explainable and the pipeline simple for V1. The grader's structured
feedback still drives the one allowed regeneration, so the system corrects
itself instead of just failing outright.

### The loop this feeds

1. Retrieve → grade context. Irrelevant → rewrite once, re-retrieve. Still
   irrelevant → abstain.
2. Generate → grade answer. Not grounded → regenerate once with the grader's
   feedback. Still not grounded → abstain.
3. An abstention names the closest retrieved chunks and why they don't answer
   the question — never a guess.

### Grader output shape

The answer grader returns structured JSON (Groq `json_schema`, per
[ADR 0003](0003-providers-and-quotas.md)):
`{ grounded: boolean, unsupportedClaims: string[], reason: string }`.
`unsupportedClaims` becomes the regeneration feedback when `grounded` is
false.

## Consequences

- A true, well-known fact with no matching chunk is treated the same as a
  wrong one. This is deliberate and needs to be stated plainly in the eval
  write-up, so a hallucination number isn't misread as "the model was
  factually wrong."
- Binary grounding can abstain on mostly-right answers. The over-abstention
  metric exists to surface that tradeoff, not hide it.

## Alternatives considered

| Option                                             | Why not                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Partial-credit scoring                             | No clean pass/fail threshold, and a score doesn't tell regeneration what to fix    |
| Skip context grading, verify only the final answer | Skips the cheaper batched check and lets bad retrieval reach generation every time |
| Unlimited regeneration attempts                    | Could loop expensively without converging; CLAUDE.md already bounds this at 1      |

## Open questions for joint review

- None blocking Week 1. Revisit binary-vs-partial after the first dev-split
  run shows how often one unsupported claim shows up in an otherwise good
  answer.
