# OpenRef

OpenRef is a production-oriented TypeScript SDK for web-grounded answers with optional inline citations.

```text
Query -> Web Search -> Content Extraction/Chunking -> Streaming Chat Response
```

## Features

- Web search with provider fallback (`Brave` -> `DuckDuckGo`)
- Source deduplication and domain diversity filtering
- Optional LLM reranking of search candidates
- Query-aware page extraction and chunk scoring
- Streaming chat response
- Configurable citation behavior (`citationStrictness`)
- Typed SDK surface (`search`, `chat`, event streams)

## Install

```bash
npm install @altamsh04/openref
```

## Quick Start

```ts
import { OpenRef } from "@altamsh04/openref";

const agent = new OpenRef({
  llm: {
    apiKey: "sk-or-v1......",
    chatModel: "stepfun/step-3.5-flash:free",
    fallbackChatModels: [
      "nvidia/nemotron-3-nano-30b-a3b:free",
      "mistralai/mistral-small-3.1-24b-instruct:free"
    ],
    systemPrompt: "Answer in short bullet points.",
    citationStrictness: true,
    maxRetries: 2,
    retryDelayMs: 1200,
    maxOutputTokens: 2048,
    maxContinuationRequests: 2
  },
  search: {
    preferLatest: true,
    timeZone: "America/New_York",
    maxSources: 5,
    searchTimeout: 5000,
    enableReranking: true,
    rerankTimeout: 4000
  },
  retrieval: {
    contentTimeout: 6000,
    maxContextTokens: 6000,
    chunkTargetTokens: 400
  },
  response: {
    stream: true
  }
});

const query = "Today's top news in AI";

async function run() {
  // Per-request overrides
  const response = await agent.chat(query, {
    stream: false,
    systemPrompt: "Keep it under 120 words and mention uncertainty clearly.",
    citationStrictness: false
  });

  console.log(JSON.stringify(response, null, 2));
}

run();
```

## Local Example

Run the local SDK example:

```bash
OPENROUTER_API_KEY=sk-or-v1-xxxx npm run example:run -- "Today's top news in AI"
```

Run dedicated non-stream and stream examples:

```bash
OPENROUTER_API_KEY=sk-or-v1-xxxx npm run example:non-stream -- "What is OpenRouter?"
OPENROUTER_API_KEY=sk-or-v1-xxxx npm run example:stream -- "What is OpenRouter?"
```

Files:
- `example/index.ts` example app using local source (`../src`)
- `example/non-stream.ts` non-stream response example
- `example/stream.ts` stream response example
- `tsconfig.example.json` example build config

## API

### `new OpenRef(config)`

#### `config.llm`
- `apiKey?: string` OpenRouter API key. Preferred key location.
- `chatModel?: string` Primary chat model.
- `fallbackChatModels?: string[]` Models used if primary model fails.
- `systemPrompt?: string` Base system instruction for response style/behavior.
- `citationStrictness?: boolean` Citation policy in response text.
- `maxRetries?: number` Retry attempts per model request.
- `retryDelayMs?: number` Backoff delay between retries.
- `maxOutputTokens?: number` Max tokens per generation request.
- `maxContinuationRequests?: number` Extra continuation requests when output is truncated.

`citationStrictness` behavior:
- `true` (default): model is instructed to include inline `[N]` citations for factual claims.
- `false`: model is instructed to avoid `[N]` citations unless user explicitly asks.

#### `config.search`
- `preferLatest?: boolean` Adds recency bias to search and prompting.
- `timeZone?: string` Used for date context formatting.
- `maxSources?: number` Final number of sources to keep.
- `searchTimeout?: number` Search request timeout in ms.
- `enableReranking?: boolean` Enable LLM reranking for candidates.
- `rerankTimeout?: number` Reranking timeout in ms.

#### `config.retrieval`
- `contentTimeout?: number` Page fetch/extraction timeout in ms.
- `maxContextTokens?: number` Token budget for assembled context.
- `chunkTargetTokens?: number` Approximate target size of chunks.

#### `config.response`
- `stream?: boolean` Default chat mode (`true` for event stream, `false` for aggregated response).

### `search(query: string): Promise<SearchResult>`

Runs retrieval and ranking only.

### `chat(query: string, options?)`

Per-request options:
- `stream?: boolean`
- `systemPrompt?: string` Overrides constructor `llm.systemPrompt`.
- `citationStrictness?: boolean` Overrides constructor `llm.citationStrictness`.

When `stream: true`, returns `AsyncGenerator<ChatEvent>` with:
- `sources`
- `text` (multiple chunks)
- `citations`
- `done`

When `stream: false`, returns `Promise<ChatResponse>` with:
- `text`
- `sources`
- `citationMap`
- `chatTokenUsage`
- `metadata`

## Legacy Config Support

Top-level fields like `openRouterApiKey`, `chatModel`, `maxSources`, etc. are still accepted for backward compatibility.

Preferred format is grouped config (`llm`, `search`, `retrieval`, `response`).

## Test Before Publish

Run full pre-publish checks:

```bash
npm run check
```

This runs:
- `npm run typecheck` (`tsc --noEmit`)
- `npm run test:smoke` (build + SDK smoke checks)
- `npm run test:pack` (build + `npm pack` install/import verification in a temp project)

`test:pack` tries a real temp-project install first. If npm registry access is unavailable, it automatically runs an offline tarball import fallback.

### Smoke Test Modes

- Without `OPENROUTER_API_KEY`:
  - validates constructor/config compatibility (grouped + legacy)
  - validates API surface (`search`, `chat`)
  - skips live network requests

- With `OPENROUTER_API_KEY`:
  - runs live `search`
  - runs `chat` non-stream
  - runs `chat` stream and confirms `done` event

Example:

```bash
OPENROUTER_API_KEY=sk-or-v1-xxxx npm run test:smoke
```

## Notes

- `query` must be a non-empty string.
- If no sources are found, `chat` returns a graceful text response with empty citation map.
- OpenRef uses OpenRouter-compatible chat models for reranking and response generation.
