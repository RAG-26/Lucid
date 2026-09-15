# ADR 0002: Prompts and citations

- **Status:** Proposed
- **Owner:** Joint (drafted by Dhananjay)
- **Reviewers:** Navnita
- **Date:** 2026-09-15

## Context

The generator (Navnita) produces answers with `[n]` citations; the answer
grader (Dhananjay) checks those citations against retrieved chunks
([ADR 0004](0004-abstention-policy.md)). Both need the exact same citation
contract, or grading fails on a format mismatch instead of a real groundedness
problem. This ADR fixes that contract and the abstention message template.

## Decision

### Citation format

- Retrieved chunks are numbered 1..k in the order passed to the generator —
  retrieval's ranking order, not an authority ranking.
- The generator cites a claim with `[n]` immediately after the sentence it
  supports, using the prompt's numbering. Multiple sources: `[1][3]`, not `[1, 3]`.
- `GenerationResult.citations` lists only the `{ index, chunkId }` pairs
  actually used in the answer text, mapped back to `chunks[n-1].id`. A chunk
  passed to the generator but never cited doesn't appear here.
- A citation number outside 1..k is a grounding failure, not a parsing error —
  the answer grader treats it as an unsupported claim.

### Generator prompt shape

- System instructions: answer only from the numbered chunks, cite every
  factual claim, and say so instead of guessing when the chunks don't support
  an answer. This is a soft backstop — prompting alone doesn't reliably
  prevent hallucination, which is exactly why the answer grader exists.
- User content: the question, then the numbered chunks (breadcrumb + content,
  per [ADR 0001](0001-chunking-and-embeddings.md)).
- On the one allowed regeneration ([ADR 0004](0004-abstention-policy.md)), the
  prompt appends the grader's `unsupportedClaims` as explicit feedback and
  asks the generator to answer again using only what the sources support.

### Abstention wording

- Template: "The indexed docs don't cover this. The closest sources I found
  were: `<breadcrumb>`, `<breadcrumb>` — but they don't answer the question."
- The breadcrumbs come from `PipelineResult.nearestChunks`: the originally
  retrieved chunks when context grading found nothing relevant, or the
  still-ungrounded chunks when answer grading fails twice.
- Abstention text is a fixed template, not another LLM call — abstaining
  should never itself risk producing an ungrounded sentence.

## Consequences

- `core/generation` and `core/correction` both read citation numbering from
  `core/types.ts`'s `Citation` shape; neither hardcodes its own.
- Changing the citation syntax is a shared-contract change needing both
  owners' agreement, per CLAUDE.md.

## Alternatives considered

| Option                                            | Why not                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Footnote-style citations at the end of the answer | Inline `[n]` lets the grader attribute one specific claim to one specific source |
| Cite by chunk ID directly in the text             | Chunk IDs are content hashes — unreadable inline and bad for the UI              |

## Open questions for joint review

- The exact system-prompt wording is Navnita's to finalize when she builds
  `core/generation`; this ADR fixes the contract (numbering, citations array,
  abstention trigger), not the prompt's literal English.
