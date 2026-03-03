# How OpenRef Works

## Overview
OpenRef is a TypeScript SDK that converts a plain-language query into a web-grounded answer with inline citations.

Core runtime path:

1. Receive user query.
2. Search the web (Brave first, DuckDuckGo fallback).
3. Deduplicate and diversify candidate sources.
4. Optionally rerank sources with an LLM.
5. Fetch pages and extract query-relevant sections.
6. Chunk and score extracted text against the query.
7. Build compact context from top chunks.
8. Stream a final answer from the chat model with `[N]` citations.

## High-Level Module Architecture

- `src/agent.ts`: Orchestrator (`OpenRef` class), defaults, search + chat entry points.
- `src/search.ts`: HTML-based search adapters and provider fallback.
- `src/ranker.ts`: URL deduplication, domain diversity, optional LLM reranking.
- `src/markdown.ts`: Page fetching, query-aware extraction, and source enrichment.
- `src/chunker.ts`: Token estimation, chunk splitting, chunk scoring, context selection.
- `src/chat.ts`: Prompting, streaming response handling, fallback models, retries, usage accounting.
- `src/llmclient.ts`: OpenRouter OpenAI-compatible client construction and caching.
- `src/types.ts`: Public and internal type contracts.

## End-to-End Flow

### 1) Initialization (`new OpenRef(config)`)
`OpenRef` validates `openRouterApiKey` and merges user config with operational defaults such as:

- streaming enabled
- `preferLatest` recency bias
- model + fallback model list
- retry policy (`maxRetries`, backoff via `retryDelayMs`)
- search/content/rerank timeouts
- context and chunk token budgets

This makes every request deterministic with explicit upper bounds for latency and token usage.

### 2) Query Intake and Date Context
Each request must pass `assertValidQuery` (non-empty string).

If `preferLatest` is enabled, OpenRef builds a date-aware search query using timezone-aware context (`year`, `monthYear`, `dateLabel`). This pushes search toward fresher results while preserving the original user intent.

### 3) Web Search Layer (`searchWeb`)
Search strategy:

1. Try Brave HTML search.
2. If Brave returns zero hits, fallback to DuckDuckGo HTML search.

For each provider, OpenRef:

- sends browser-like headers/user-agent
- applies timeout via `AbortSignal.timeout`
- parses HTML with Cheerio
- extracts `(url, title, snippet)`
- removes obvious self-links/provider links and duplicates

Result at this stage: `RawSearchHit[]`.

### 4) Fast Candidate Selection (`fastFilter`)
OpenRef converts raw hits into `Source[]` by:

- deduplicating by exact URL
- extracting normalized domain (`www.` stripped)
- promoting domain diversity so one site does not dominate the candidate pool

This produces a broad but controlled candidate set (default cap: 30).

### 5) Optional LLM Reranking (`llmRerank`)
If reranking is enabled and candidate count exceeds `maxSources`, OpenRef asks the LLM to reorder results by relevance.

Input to ranker:

- original query
- numbered candidates (`[i] Title — snippet`)
- instruction to return JSON array of IDs in relevance order
- optional recency instruction when `preferLatest=true`

Robustness behavior:

- strict JSON parse first
- regex numeric fallback if JSON is malformed
- timeout/error fallback to pre-rerank order
- partial outputs are backfilled with remaining candidates

Result: bounded `Source[]` suitable for content extraction.

### 6) Content Fetch + Query-Aware Extraction (`fetchAndChunk`)
For each selected source, OpenRef fetches the page and extracts relevant text.

Extraction design:

- strips non-content blocks (`script`, nav, ads, sidebars, comments, etc.)
- prefers semantic containers (`article`, `main`, role-based main)
- walks leaf text blocks (`p`, headings, `li`, `section`, etc.)
- marks blocks relevant if they contain any query term
- keeps matched blocks plus nearby context blocks
- falls back to compact body/main text if relevance matching is weak
- caps per-page extracted text size

Concurrency and early-stop behavior:

- all sources process concurrently
- each source is independently fetch -> extract -> chunk -> score
- tracks cumulative token collection
- aborts in-flight work early when enough context has been gathered (`~1.5x` budget threshold)

Output:

- `enrichedSources` (with optional `markdown`, `markdownTokens`)
- `ScoredChunk[]` selected to fit context budget

### 7) Chunking + Relevance Scoring (`chunker.ts`)
Chunking strategy:

- split on paragraph boundaries first
- if a paragraph is too large, split by sentence boundaries
- estimate tokens as `ceil(chars / 4)`

Scoring strategy:

- tokenize query and expanded queries
- count term occurrences in each chunk
- apply diminishing returns (`log2(1 + matches)`)
- normalize by chunk size (`/ sqrt(tokenEstimate)`) to reduce long-chunk bias

Selection strategy (`selectTopChunks`):

1. Guarantee source coverage by taking best chunk from each source (budget permitting).
2. Fill remaining budget greedily by highest score.
3. Sort final chunks by source/chunk order for coherent reading.

This balances relevance, diversity, and context coherence.

### 8) Prompt Assembly and Answer Generation (`streamChat`)
OpenRef assembles prompt context in two formats:

- preferred: compact `SOURCES + EXCERPTS` from selected chunks
- fallback: full per-source markdown when chunks are not available

Prompt behavior:

- system instruction requires inline citation markers `[N]`
- user prompt includes query + web source context
- optional recency guidance includes current datetime

Generation behavior:

- uses primary `chatModel`, then `fallbackChatModels` if needed
- streams tokens incrementally (`stream: true`)
- tracks usage (`prompt`, `completion`, `total` tokens)
- retries retryable failures (429/408/409/5xx) with incremental delay
- if output is truncated (`finish_reason=length`), sends continuation prompt and resumes, up to configured continuation limit

Failure behavior:

- returns actionable error text for common model/provider failures
- returns accumulated usage even on failure path

### 9) Citation Mapping and Final Return
Citations are mapped deterministically by source order:

- source 1 -> `[1]`
- source 2 -> `[2]`
- ...

`buildCitationMap` returns `{ [N]: { url, title, domain } }`, allowing consumers to render verifiable references next to generated claims.

## API Execution Modes

### Streaming Mode (`chat(..., { stream: true })`)
Returns an `AsyncGenerator<ChatEvent>` with event sequence:

1. `sources`
2. one or more `text` chunks
3. `citations`
4. `done` (includes `chatTokenUsage` + `citationMap`)

Use this when you need progressive rendering in UI/CLI.

### Non-Streaming Mode (`chat(..., { stream: false })`)
Runs the same pipeline but aggregates text internally and returns a single `ChatResponse` object with:

- full answer text
- sources
- citation map
- search metadata
- chat token usage

### Search-Only Mode (`search(query)`)
Runs only retrieval and ranking. Returns `SearchResult` with metadata and bounded source list.

## Reliability and Safety Controls

OpenRef includes multiple guardrails to keep behavior stable in production:

- strict query validation
- hard timeouts for search/content/rerank
- provider fallback at search layer
- model fallback at generation layer
- bounded retries with delay
- graceful empty-source responses
- bounded context and output token limits
- deterministic citation mapping

## Token and Cost Management

Cost and latency are controlled through:

- `maxSources`: reduces pages fetched and context breadth
- `chunkTargetTokens`: controls chunk granularity
- `maxContextTokens`: caps context fed to model
- `maxOutputTokens`: caps per generation request
- `maxContinuationRequests`: bounds long-answer continuation loops

The effective tradeoff is:

- lower limits -> faster/cheaper, possibly less complete answers
- higher limits -> richer answers, higher latency/cost

## Practical Operational Notes

- Search providers are parsed from HTML structure; provider markup changes can require parser updates.
- Recency preference biases retrieval and prompting, but cannot guarantee every source is latest unless the web results themselves are fresh.
- Citation quality depends on retrieved content quality and extraction success.
- For strict domains (legal/medical/finance), downstream consumers should add policy checks, confidence thresholds, or human review.

## Typical Request Timeline

1. Query enters `OpenRef.chat`.
2. `search()` retrieves and ranks sources.
3. `fetchAndChunk()` builds budgeted context from relevant page sections.
4. `streamChat()` generates cited answer with retries/fallbacks.
5. SDK emits sources, text stream, citation map, and usage metadata.

That flow is the core of OpenRef: retrieval-grounded generation with traceable citations, bounded by explicit latency and token controls.
