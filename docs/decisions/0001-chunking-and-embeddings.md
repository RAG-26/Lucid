# ADR 0001: Chunking and embeddings

- **Status:** Proposed (draft; the chunking parameters freeze on Week 3, Day 1)
- **Owner:** Navnita
- **Reviewers:** Dhananjay
- **Date:** 2026-09-15

## Context

Lucid retrieves chunks of Kubernetes and Docker documentation (see
[`docs/data-sources.md`](../data-sources.md)) and passes the top k to Groq models
for grading and generation. Four constraints shape this decision:

1. **Groq free-tier budget.** Each model gets 8K tokens/minute and 200K
   tokens/day. In corrective mode the retrieved context is sent at least twice
   to the grader (grade context, grade answer) and once or twice to the
   generator (generate, regenerate). gpt-oss models also spend reasoning tokens.
   Context size (k × chunk tokens) is therefore the main cost lever.
2. **Both machines are Apple Silicon Macs** (Navnita: M5, 16 GB; Dhananjay:
   M2 MacBook Air, 2022). Embedding runs locally and must give the same vectors on both.
3. **Overlapping vocabulary.** Both corpora use terms like volumes, secrets,
   networks, and build cache. A chunk must say which product and page it comes from.
4. **Eval comparability.** Changing chunking or the embedding setup invalidates
   eval results, so the setup must be pinned and changed only deliberately.

Corpus measurements at the pinned commits (nomic tokens, before cleaning):
~1.07M Kubernetes + ~0.84M Docker tokens. Heading-delimited sections are small
(p50 ≈ 170 tokens, p90 ≈ 540, p99 1.3–1.7K). About 12% of sections are under 50 tokens,
and 20–25% of lines are inside code fences.

## Decision

### Embeddings (proposed as final)

| Setting | Value |
|---|---|
| Model | `nomic-ai/nomic-embed-text-v1.5` |
| Revision | `e9b6763023c676ca8431644204f50c2b100d9aab` (pinned; never `main`) |
| Runtime | `@huggingface/transformers` `4.2.0` (exact), ONNX Runtime on CPU |
| dtype | `fp32` (`onnx/model.onnx`) |
| Pooling | Mean pooling, then L2 normalization |
| Dimensions | 768 (no Matryoshka truncation) |
| Prefixes | `search_document: ` for chunks, `search_query: ` for questions |
| API | `core/embeddings` exposes only `embedDocuments(texts)` and `embedQuery(text)` |
| Model cache | Explicit, gitignored cache directory set via config, not the package-internal default |

- **L2 normalization:** vectors have length 1, so cosine similarity equals
  the dot product. pgvector's cosine distance (`<=>`) and the HNSW
  `vector_cosine_ops` index then behave as expected.
- **Prefixes:** nomic was trained with task prefixes so short questions and long
  passages map into a shared space. A missing prefix doesn't raise an error; it just
  quietly lowers retrieval quality. That's why the API makes prefixes impossible to forget.

### Chunking (proposed default, confirmed or replaced by the Week 2 sweep)

1. **Clean** Hugo Markdown per the rules in `data-sources.md`. Resolving
   `{{% heading %}}` into real headings happens before splitting.
2. **Split on headings** (H2 and H3). A fenced code block is never split.
3. **Merge small sections.** A section below `min_tokens` joins the next section
   under the same parent heading, or the previous one if it's the last.
4. **Split oversized sections** at paragraph boundaries (then at line boundaries
   for long code), with `overlap_tokens` of overlap between the pieces.
5. **Prepend a breadcrumb** to the embedded and stored text:
   `Kubernetes > Concepts > Storage > Volumes > hostPath`. This puts the product
   and page context back into every chunk (constraint 3).
6. **Count all limits in nomic tokens**, including breadcrumb and prefix, since
   nomic tokens govern truncation. Report "tokens per query" in `o200k` tokens,
   which is what Groq bills. In this corpus, o200k counts are about 0.84× nomic counts.

Default hypothesis: `max_tokens = 512`, `min_tokens = 100`, `overlap_tokens = 64`, `k = 5`.

### Sweep plan (Week 2, dev split only)

| Config | max | min | overlap | Notes |
|---|---|---|---|---|
| S | 256 | 64 | 32 | Precise chunks, but more of them are needed per answer |
| M | 512 | 100 | 64 | Default hypothesis; ~89% of raw sections fit whole |
| L | 1024 | 200 | 64 | Whole-section chunks; highest context cost |

- Each config is evaluated at k ∈ {3, 5, 8}. Changing k needs no re-ingest.
- **Metrics:** recall@k, MRR, and mean o200k context tokens per query.
- **Selection rule:** pick the config with the best recall@5 whose
  mean context stays at or under ~2,500 o200k tokens, so a corrective request
  fits under the 8K tokens/minute limit. Among configs within 2 recall points
  of each other, pick the cheaper one.

### Corpus scope

- Exclude Docker Engine release notes (~25% of the Docker corpus; see `data-sources.md`).
- Exclude pages Hugo never renders, except when they are included from another page.

### Chunk identity

- **Chunk ID:** `sha256(source | doc_path | heading_path | ordinal)`.
- **Document content hash:** lets re-ingestion skip unchanged documents and keeps
  upserts idempotent.
- The exact columns belong to the DB schema contract and need joint review.

## Evidence: embedding smoke test (Navnita's M5, 2026-09-15)

The test used 5 hand-written overlapping Kubernetes/Docker passages and 4 questions.
Throughput was measured on 28 real chunks (14,858 tokens) from the Kubernetes
volumes page, embedded in batches of 8.

| | fp32 | q8 (`model_quantized.onnx`) |
|---|---|---|
| Correct passage ranked #1 (with prefixes) | 4 / 4 | 4 / 4 |
| Throughput | 1,622 tok/s | 1,749 tok/s |
| Estimated full-corpus embed time | ~20 min | ~18 min |
| Cosine similarity to fp32 vectors | 1.0 | 0.974–0.976 |
| Checksum of passage 0 (SHA-256 of 4-dp values, first 16 hex) | `49184b9208151da9` | `1b1917d6d5c56c09` |
| First four dimensions of passage 0 | `0.04035, 0.04406, -0.17330, -0.03455` | `0.05707, 0.05139, -0.16363, -0.02857` |

What the smoke test shows:

- **fp32 over q8:** q8 is only ~8% faster on this hardware, and its vectors
  differ noticeably from fp32 (cosine similarity ≈ 0.975). Mixing the two would
  silently degrade retrieval, and switching later means re-embedding everything.
  fp32 costs ~20 minutes per full ingest, which is acceptable.
- **Prefixes:** the 4-question toy set was too easy to show a difference with or
  without prefixes (all ranked #1 either way). Their value is taken from the model
  card; confirm it on the dev split if time allows.
- **Cross-machine check (pending):** Dhananjay runs the same script on the M2 Air
  and compares vectors. Pass criterion: cosine similarity ≥ 0.9999 to Navnita's
  vectors. The exact checksum may differ if ONNX Runtime picks different CPU
  kernels on M2 vs M5, so the tolerance check is the one that counts. Also record
  M2 Air throughput, since a fanless machine may throttle over a 20+ minute ingest.

## Alternatives considered

| Option | Why not |
|---|---|
| q8 / int8 / q4 dtypes | Smaller and faster to load, but vectors drift from fp32 (measured for q8) with little speed gain on Apple Silicon |
| Matryoshka truncation to 256/512 dimensions | Saves storage, but at ~7–9K chunks the full 768-d index is only tens of MB; not worth the recall loss |
| Hosted embedding APIs | Rate limits and keys for every re-ingest and sweep; the project uses no paid APIs |
| Models with 512-token input limits (e.g. BGE-base, MiniLM) | Would force a `max_tokens = 1024` config to truncate; nomic's 8,192-token window leaves the sweep unconstrained |
| Fixed-size windows ignoring headings | Simpler, but they cut through code blocks and procedures, and lose the heading context that separates Docker from Kubernetes chunks |
| No chunking (one chunk per page) | Median page ~1.5–1.8K tokens, p90 ~5.6K; too costly for the Groq budget and too diluted for retrieval |

## Consequences

- A full re-ingest takes ~20 minutes on the M5 (M2 Air to be measured). A sweep
  of 3 configs costs about an hour of local embedding, and nothing on Groq.
- Any change to the model, revision, dtype, pooling, prefixes, cleaning rules,
  or chunk parameters needs a re-ingest and `Eval-Impact: rerun required`.
- The breadcrumb adds roughly 10–20 tokens per chunk. That's accepted, because it
  carries the disambiguation signal between the two corpora.

## Open questions for joint review

1. **Relevance labels (eval, Dhananjay):** label questions with doc path +
   heading anchor, not chunk IDs, so labels survive re-chunking and the sweep
   can compare configs. A retrieved chunk counts as relevant if its heading path
   falls under a labelled section.
2. **Token counting (core contract):** which tokenizer does the trace use for
   "tokens"? This ADR proposes nomic tokens for embedding and o200k estimates for
   LLM context, with Groq's reported `usage` as the source of truth for actual calls.
3. **Reasoning effort (`core/llm`, Dhananjay):** can gpt-oss calls use low
   reasoning effort to stay under 8K tokens/minute?
4. **Release notes:** does the planned question set include version or changelog
   questions? If so, revisit the exclusion.
5. **Embedding trace fields:** proposed `{ stage: "embed", model, revision, dtype, inputCount, tokens, latencyMs }`.
