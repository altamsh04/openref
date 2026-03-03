# OpenRef

OpenRef is a production-oriented TypeScript SDK for web-grounded answers with citations.

It keeps the runtime model simple:

```text
Query -> Web Search -> Content Extraction/Chunking -> Streaming Chat Response
```

## Features

- Web search with provider fallback (`Brave` -> `DuckDuckGo`)
- Source deduplication and domain diversity filtering
- Optional LLM reranking of search candidates
- Query-aware page extraction and chunk scoring
- Streaming chat response with inline source citations (`[N]`)
- Typed SDK surface (`search`, `chat`, event streams)

## Install

```bash
npm install @altamsh04/openref
```

## Quick Start

```ts
import { OpenRef } from "@altamsh04/openref";

const agent = new OpenRef({
  openRouterApiKey: "sk-or-v1......",
  preferLatest: true,
  timeZone: "America/New_York",
  chatModel: "stepfun/step-3.5-flash:free",
  fallbackChatModels: [
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-small-3.1-24b-instruct:free"
  ],
  maxRetries: 2,
  retryDelayMs: 1200,
  maxSources: 3,
  searchTimeout: 5000,
  contentTimeout: 6000,
  enableReranking: true,
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
});

const query = "who acquired manus AI";

async function runChat() {
  const response = await agent.chat(query, { stream: false });
  console.log(JSON.stringify(response, null, 2));
}

runChat();
```

## Technical Details

- **Search Engines** — Brave Search (primary), DuckDuckGo (fallback), with parallel failover
- **Streaming** — All output modes use `AsyncGenerator` for non-blocking event streaming
- **Content Extraction** — Query-aware HTML filtering keeps only relevant sections before chunking
- **Chunk Scoring** — TF-based relevance scoring against the original query
- **Domain Diversity** — Prevents source stacking from the same domain
- **LLM Provider** — Routes through OpenRouter, compatible with any supported model
- **Token Management** — Per-request tracking with configurable context and chunk budgets

## API

### `new OpenRef(config)`

Required:
- `openRouterApiKey: string`

Optional:
- `stream?: boolean` (default `true`)
- `preferLatest?: boolean` (default `true`)
- `timeZone?: string` (default `"UTC"`)
- `chatModel?: string`
- `fallbackChatModels?: string[]` (default `[]`)
- `maxRetries?: number` (default `2`)
- `retryDelayMs?: number` (default `1200`)
- `maxOutputTokens?: number` (default `2048`)
- `maxContinuationRequests?: number` (default `2`)
- `maxSources?: number`
- `searchTimeout?: number`
- `contentTimeout?: number`
- `enableReranking?: boolean`
- `rerankTimeout?: number`
- `maxContextTokens?: number`
- `chunkTargetTokens?: number`

### `search(query: string): Promise<SearchResult>`

Returns ranked sources and search metadata.

### `chat(query: string, options?: { stream?: boolean })`

When `stream` is `true` (default), returns `AsyncGenerator<ChatEvent>` with sequence:
- `sources`
- `text` (multiple streamed chunks)
- `citations`
- `done`

When `stream` is `false`, returns `Promise<ChatResponse>`:
- full `text` (non-stream)
- `sources`
- `citationMap`
- `chatTokenUsage`

## Notes

- `query` must be a non-empty string.
- If no sources are found, `chat` returns a graceful text response and empty citation map.
- OpenRef uses OpenRouter-compatible chat models for reranking and response generation.
