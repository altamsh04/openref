# OpenRef

An agentic web search SDK that transforms natural language queries into ranked, cited web sources. 

## What It Does

OpenRef takes a plain-text query and runs it through a multi-stage pipeline — searching the web, ranking results, extracting content, and optionally generating LLM-powered answers with proper citations.

## Modes

**Search** — Returns ranked web sources for a query with metadata like title, URL, domain, and snippet. Results are deduplicated and diversified across domains.

**Chat** — Streams an LLM-generated answer grounded in fetched web content. Responses include inline numbered citations mapped back to their source URLs.

**Deep Research** — Iterative multi-pass research. Generates an initial answer, critiques it for knowledge gaps, runs follow-up searches to fill those gaps, and regenerates — repeating until the answer is complete.

## Pipeline

```
Query → Intent Detection → Web Search → Fast Filter → LLM Rerank → Content Fetch → Chunking → Answer Generation
```

1. **Intent Detection** — Classifies the query (factual, research, how-to, current events) to guide search strategy
2. **Web Search** — Queries Brave Search with automatic DuckDuckGo fallback
3. **Fast Filter** — Deduplicates results and promotes domain diversity
4. **LLM Rerank** — Optionally reranks candidates by relevance using an LLM
5. **Content Fetch** — Extracts clean markdown from source pages with query-aware section filtering
6. **Chunking** — Splits content into scored chunks based on term relevance to the query
7. **Answer Generation** — Streams a cited response within a controlled token budget

## Example

```typescript
import { OpenRef } from "openref";

const openref = new OpenRef({
  openRouterApiKey: process.env.OPENROUTER_API_KEY!,
  model: "stepfun/step-3.5-flash:free",
  chatModel: "stepfun/step-3.5-flash:free",
  maxSources: 3,
  searchTimeout: 5000,
  fetchContent: true,
  contentTimeout: 6000,
  chat: true,
  enableReranking: true,
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
});

for await (const event of openref.chat("Recent AI funding rounds and startup news")) {
  if (event.type === "sources") console.log(`Found ${event.data.sources.length} sources`);
  if (event.type === "text") process.stdout.write(event.data);
  if (event.type === "citations") console.log("\nCitations:", event.data);
}
```

**Output:**

```
Nearly twenty U.S.-based AI startups secured funding rounds of at least $100
million in the first few weeks of 2026, following a 2025 where U.S. AI startups
raised over $76 billion in such "megarounds" [1]. Australian AI infrastructure
startup Firmus secured a $10 billion debt financing led by Blackstone and Coatue
to build a network of "AI factories" [3]. Marketing tech startup Fibr AI raised
$5.7M in a seed round led by Accel [3]. Qualcomm announced a $150 million
investment in Indian AI and tech startups [2].

Citations:
  [1] AI Startup Funding 2026: $100M+ Rounds Signal Strong Start — indexbox.io
  [2] Latest Startup | Technology News — entrackr.com
  [3] AI Startups News: Latest Innovations, Funding, and Industry Updates — scenefordummies.com
```

**Full JSON response:**

```json
{
  "query": "Recent AI funding rounds and startup news",
  "intent": "current",
  "sources": [
    {
      "url": "https://www.indexbox.io/blog/us-ai-startups-secure-100m-rounds-in-early-2026/",
      "title": "AI Startup Funding 2026: $100M+ Rounds Signal Strong Start",
      "domain": "indexbox.io"
    },
    {
      "url": "https://entrackr.com/",
      "title": "Latest Startup | Technology News | Entrackr",
      "domain": "entrackr.com"
    },
    {
      "url": "https://scenefordummies.com/news/ai-startups-news-latest-innovations-funding-and-industry-updates/",
      "title": "AI Startups News: Latest Innovations, Funding, and Industry Updates",
      "domain": "scenefordummies.com"
    }
  ],
  "metadata": {
    "latencyMs": 9178,
    "queriesExecuted": 1,
    "totalResults": 3,
  },
  "chatTokenUsage": {
    "promptTokens": 1892,
    "completionTokens": 700,
    "totalTokens": 2592
  },
  "citationMap": {
    "1": { "url": "https://www.indexbox.io/...", "title": "AI Startup Funding 2026...", "domain": "indexbox.io" },
    "2": { "url": "https://entrackr.com/", "title": "Latest Startup | Technology News", "domain": "entrackr.com" },
    "3": { "url": "https://scenefordummies.com/...", "title": "AI Startups News...", "domain": "scenefordummies.com" }
  }
}
```

## Technical Details

- **Search Engines** — Brave Search (primary), DuckDuckGo (fallback), with parallel failover
- **Streaming** — All output modes use `AsyncGenerator` for non-blocking event streaming
- **Content Extraction** — Query-aware HTML filtering keeps only relevant sections before chunking
- **Chunk Scoring** — TF-based relevance scoring against the original query
- **Domain Diversity** — Prevents source stacking from the same domain
- **LLM Provider** — Routes through OpenRouter, compatible with any supported model
- **Token Management** — Per-request tracking with configurable context and chunk budgets
