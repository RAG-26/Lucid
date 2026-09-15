# Data sources

Lucid answers questions over two public documentation sets. Both are cloned at
pinned commits so ingestion, retrieval metrics, and eval results are
reproducible. Raw clones live under `data/` and are not committed.

> Changing a pinned SHA, an included path, or an exclusion rule changes the
> corpus. That invalidates eval results and needs `Eval-Impact: rerun required`.

## Pinned sources

| Source | Repository | Commit | Commit date | License |
|---|---|---|---|---|
| Kubernetes docs | [kubernetes/website](https://github.com/kubernetes/website) | `b4b3affab0b8f4537a4c1b1b16b6cbb8eb988197` | 2026-09-15 | [CC BY 4.0](https://github.com/kubernetes/website/blob/main/LICENSE) |
| Docker docs | [docker/docs](https://github.com/docker/docs) | `083f66104491efe09ed5347367a6e674eaac214d` | 2026-09-14 | [Apache 2.0](https://github.com/docker/docs/blob/main/LICENSE) |

## What is ingested

### Kubernetes

| Path | Role |
|---|---|
| `content/en/docs/concepts/**` | Corpus (186 Markdown files) |
| `content/en/docs/tasks/**` | Corpus (221 Markdown files) |
| `content/en/includes/**` | Resolves `include` shortcodes; not indexed on its own |
| `content/en/examples/**` | Resolves `code_sample` shortcodes; not indexed on its own |
| `content/en/docs/reference/glossary/**` | Resolves `glossary_definition`; not indexed on its own |
| `hugo.toml` | Resolves `param` / `skew` version values (`latest = "v1.37"`) |
| `i18n/en/en.toml` | Resolves `heading` shortcodes (e.g. `whatsnext` → "What's next") |

Canonical URL: `https://kubernetes.io/` + path without `content/en/` and `.md`
(`_index.md` maps to its directory), with a trailing slash. For example,
`content/en/docs/concepts/storage/volumes.md` →
`https://kubernetes.io/docs/concepts/storage/volumes/`.

### Docker

| Path | Role |
|---|---|
| `content/manuals/engine/**` | Corpus (157 Markdown files, release notes excluded, see below) |
| `content/manuals/compose/**` | Corpus (44 Markdown files) |
| `content/manuals/build/**` | Corpus (96 Markdown files) |
| `content/includes/**` | Resolves `include` shortcodes; not indexed on its own |
| `hugo.yaml` | Resolves `param` shortcodes and URL permalinks |

Canonical URL: `https://docs.docker.com/` + path without `content/manuals/` and
`.md`, with a trailing slash (per the `permalinks` rule in `hugo.yaml`). For example,
`content/manuals/compose/how-tos/use-secrets.md` →
`https://docs.docker.com/compose/how-tos/use-secrets/`.

## Exclusions (proposed, see ADR 0001)

| Rule | Why |
|---|---|
| `docker-docs/content/manuals/engine/release-notes/**` | 28 files, ~85k words (~25% of the Docker corpus). Changelog bullet lists match almost any keyword but rarely answer how-to questions, so they would crowd out useful chunks. |
| Pages with `build.render: never` (Docker) or `_build.render: never` (Kubernetes) | Hugo never publishes them, so they have no URL to cite. They are still resolved when another page includes them (e.g. `tasks/tools/included/*`). |
| Pages with no body after cleaning (e.g. section `_index.md` pages that only hold frontmatter) | Nothing to retrieve. |
| Non-Markdown files (images, `.gliffy`, `.dot`, `.excalidraw`) | Out of scope for V1 (no multimodal/OCR). |

## Corpus size at the pinned commits

Measured before cleaning, release notes included. Token counts use the nomic
tokenizer (`bert-base-uncased` WordPiece) unless noted.

| | Kubernetes | Docker |
|---|---|---|
| Markdown files | 407 | 297 |
| Tokens (nomic) | 1,070,685 | 839,804 |
| Tokens (o200k, what Groq bills) | 921,394 | 688,935 |
| Share of lines inside code fences | 20.5% | 25.5% |
| Heading-delimited sections | 4,140 | 3,253 |
| Section tokens p50 / p90 / p99 | 180 / 544 / 1,296 | 156 / 543 / 1,702 |
| Sections under 50 tokens | 393 | 520 |

## Hugo cleaning rules

Both sites are Hugo Markdown. Shortcodes are Go-template tags such as
`{{< name args >}}` (inner content is not Markdown-rendered) or
`{{% name args %}}` (inner content is Markdown-rendered). Counts are openers in
the corpus paths above. Rules marked *resolve* read the data files listed earlier.

### Kubernetes

| Shortcode | Count | Handling |
|---|---|---|
| `glossary_tooltip text="…" term_id="…"` | 747 | Replace with `text` |
| `note` / `caution` / `warning` | 584 / 84 / 38 | Unwrap, prefix the body with `Note:` / `Caution:` / `Warning:` |
| `heading "…"` | 447 | *Resolve* via `i18n/en/en.toml` (`<key>_heading`) and emit a real `##` heading, so heading-based chunking sees it |
| `feature-state for_k8s_version="…" state="…"` | 354 | Replace with `FEATURE STATE: Kubernetes v1.21 [stable]`; the `feature_gate_name` form becomes `Feature gate: <Name>` |
| `code_sample file="…"` | 276 | *Resolve* from `content/en/examples/` and inline as a fenced code block |
| `skew …` / `param "version"` | 187 / 92 | *Resolve* from `hugo.toml` |
| `include "…"` | 134 | *Resolve* from `content/en/includes/`, or relative to the page directory for `included/…` |
| `tabs` / `tab name="…"` | 54 / 128 | Unwrap; each tab becomes a labelled block. When `codelang` is set, wrap the tab body in a fence |
| `version-check`, `thirdparty-content`, `comment` | 90 / 38 / 8 | Drop (site boilerplate) |
| `glossary_definition term_id="…" prepend="…"` | 33 | *Resolve* the glossary entry body (drop its `<!--more-->` marker) |
| `mermaid`, `figure`, `api-reference`, `highlight`, `table`, `details`, others | < 25 each | `figure`: keep caption/alt text. `mermaid`: drop. Others: unwrap |

### Docker

| Construct | Count | Handling |
|---|---|---|
| `param "…"` | 229 | *Resolve* from `hugo.yaml` params |
| `release-date date="…"` | 105 | Replace with `Release date: YYYY-MM-DD` (mostly in excluded release notes) |
| `tabs` / `tab name="…"` | 32 / 75 | Unwrap; each tab becomes a labelled block |
| `include "…"` | 41 | *Resolve* from `content/includes/` |
| `summary-bar feature_name="…"` | 39 | Drop (subscription badge metadata, not documentation text) |
| GitHub-style callouts `> [!NOTE]` etc. | 321 | Convert to `Note:` / `Tip:` / `Important:` / `Warning:` / `Caution:` paragraphs |
| `button`, `grid`, `sectionlinks`, `youtube-embed`, `inline-image` | < 10 each | Drop; keep `accordion` / `experimental` bodies |

Docker ships `layouts/_shortcodes/*.markdown.md`, which render several
shortcodes to plain Markdown. These are a useful reference when checking our
output.

## Reproducing the clones

```bash
git init data/kubernetes-website && git -C data/kubernetes-website remote add origin https://github.com/kubernetes/website && git -C data/kubernetes-website sparse-checkout set --no-cone /content/en/docs/concepts/ /content/en/docs/tasks/ /content/en/docs/reference/glossary/ /content/en/examples/ /content/en/includes/ /i18n/en/ /hugo.toml /LICENSE && git -C data/kubernetes-website fetch --depth 1 --filter=blob:none origin b4b3affab0b8f4537a4c1b1b16b6cbb8eb988197 && git -C data/kubernetes-website checkout FETCH_HEAD
```

```bash
git init data/docker-docs && git -C data/docker-docs remote add origin https://github.com/docker/docs && git -C data/docker-docs sparse-checkout set --no-cone /content/manuals/engine/ /content/manuals/compose/ /content/manuals/build/ /content/includes/ /hugo.yaml /LICENSE && git -C data/docker-docs fetch --depth 1 --filter=blob:none origin 083f66104491efe09ed5347367a6e674eaac214d && git -C data/docker-docs checkout FETCH_HEAD
```

Fetching one commit (`--depth 1`) by SHA with `--filter=blob:none` and a sparse
checkout downloads only the files we need (about 12 MB per repo), not each
site's full history and assets. It also works after `main` has moved on.

## Attribution

- **Kubernetes documentation:** © The Kubernetes Authors, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Lucid transforms the
  text (shortcode cleaning, chunking, embedding). Every chunk keeps its canonical
  URL, and answers cite it.
- **Docker documentation:** © Docker, Inc. and contributors, licensed under the
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). The same
  transformations apply, and source URLs are retained.

The README must repeat these notices (Week 4 attribution task).
