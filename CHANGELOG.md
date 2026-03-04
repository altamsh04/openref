# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Version History

| Version | Published | Notes |
| --- | --- | --- |
| `1.2.0` | 2026-03-05 | Current public release |
| `1.1.0` | 2026-03-04 | Previous release |
| `1.0.0` | 2026-03-03 | Initial public release |

## [1.2.0] - 2026-03-05

### Added
- `search.engineProvider` configuration with:
  - `provider`: `"brave" | "duckduckgo" | "bing" | "searxng" | "searxncg"`
  - `queryUrl` for custom provider query endpoint overrides.
- `searxng` search provider support (HTML and JSON response parsing).
- `searxncg` alias support for `searxng`.
- Provider attribution in search metadata:
  - `metadata.primaryProviderUsed`
  - `metadata.providersUsed`
- Provider attribution tagging on raw hits (`RawSearchHit.provider`).
- Example output for final provider resolution in:
  - `example/non-stream.ts`
  - `example/stream.ts`
- Query expander visibility improvements:
  - `expandedQueries` surfaced consistently in search metadata and stream events when available.
  - Expanded-query fan-out executes alongside original-query retrieval.

### Changed
- Search provider selection is now ordered and configurable by `engineProvider`.
- Fallback behavior now follows configured primary provider first, then remaining mainstream providers.
- Query fan-out now runs original query search and expanded-query searches in parallel once expansions are available.
- Added zero-hit resilience retry path that re-runs plain (non-date-biased) queries when initial retrieval returns no hits.
- Query expansion failure path is explicit: if expansion fails or times out, retrieval proceeds with original query only.

### Fixed
- Improved reliability in environments where primary providers return anti-bot/captcha pages by allowing deterministic provider fallback ordering.

## [1.1.0] - 2026-03-04

### Added
- Grouped configuration surface (`llm`, `search`, `retrieval`, `response`) with legacy top-level compatibility.
- Web search pipeline with provider adapters and source normalization.
- Optional LLM query expansion.
- Optional LLM reranking.
- Streaming and non-stream chat interfaces.
- Citation mapping and configurable citation strictness.
- Content extraction, markdown chunking, and context assembly pipeline.
- Smoke and pack validation scripts for publish-time checks.

## [1.0.0] - 2026-03-03

### Added
- Initial public release of `@altamsh04/openref`.
- Legacy top-level configuration API (`openRouterApiKey`, `chatModel`, `maxSources`, etc.).
- Web search flow with provider fallback (`Brave` primary, `DuckDuckGo` fallback).
- Source deduplication and domain diversity filtering.
- Optional LLM reranking of search candidates.
- Query-aware extraction and chunk scoring for context assembly.
- Streaming chat events (`sources`, `text`, `citations`, `done`) and non-stream response mode.
- Citation map support and token usage metadata.
