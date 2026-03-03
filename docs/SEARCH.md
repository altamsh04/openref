# Search in OpenRef (High-Level)

## Purpose
The search subsystem in OpenRef is designed to turn a natural-language question into a compact, reliable set of web pages that can support a grounded answer with citations.

Its goal is not to crawl the entire web, but to:

1. Find relevant pages quickly.
2. Preserve source variety.
3. Keep context quality high enough for answer generation.
4. Stay within strict latency and token budgets.

## Runtime Search Lifecycle

At runtime, OpenRef executes search as a staged retrieval pipeline.

### 1) Query Normalization and Freshness Bias
OpenRef starts from the user’s query and optionally adds a recency-oriented framing (date/time awareness) when freshness is important.

This helps the retrieval layer prefer current information without changing the core intent of the question.

### 2) Provider-Based Discovery
OpenRef sends the query to web search providers and collects candidate result pages.

Operationally, it uses a primary provider and automatically falls back to an alternate provider when needed. This improves resilience when a provider is unavailable, rate-limited, or returns weak results.

The output of this phase is a candidate set of pages, each with URL/title and lightweight preview information.

### 3) Candidate Cleanup and Diversity Control
Raw search results are often noisy or repetitive. OpenRef refines them by:

- Removing duplicate pages.
- Normalizing sources at domain level.
- Preventing one domain from dominating the list.

This diversity control is important because multiple near-identical pages from one domain reduce factual coverage and increase hallucination risk in downstream generation.

### 4) Relevance Prioritization
After cleanup, OpenRef keeps a bounded candidate pool and optionally performs semantic reranking.

At a high level, reranking uses query intent and short result previews to reorder pages by expected answer value. If reranking is unavailable or times out, OpenRef continues with the best available heuristic order.

This makes search robust: quality improves when advanced ranking is available, but pipeline continuity does not depend on it.

## How Pages Are Taken at Runtime

Once sources are selected, OpenRef transitions from search-result metadata to actual page content.

### 1) Parallel Fetching
OpenRef fetches selected pages concurrently, not sequentially. This reduces wall-clock latency and allows the system to tolerate slow or failing pages without blocking the full request.

### 2) Content-Focused Extraction
Fetched pages are treated as full HTML documents, but only answer-relevant portions are retained.

High-level extraction strategy:

- Ignore layout/navigation/boilerplate regions.
- Prefer main article/content regions.
- Identify segments that overlap with query intent.
- Keep local surrounding context to preserve meaning.

This avoids polluting model context with headers, menus, ads, cookie banners, or unrelated page sections.

### 3) Early Stop for Efficiency
OpenRef monitors how much useful text has already been gathered. When enough high-value context is collected, it can stop additional in-flight retrieval work early.

This protects latency and model-token budget while keeping answer quality stable.

## Relevance Shaping Before Generation

OpenRef does not pass raw page dumps directly to the model. Instead, retrieved content is transformed into a curated context set:

1. Page text is split into manageable units.
2. Units are scored against the query.
3. A balanced subset is selected under a token budget.

Selection is designed to preserve both:

- Relevance depth (best matching passages)
- Source breadth (coverage across different sources)

This balance is key to producing answers that are both accurate and well-cited.

## Reliability Behavior in Real Traffic

The search and page-taking path is designed for partial failure by default.

If some pages fail to load, are blocked, or provide poor content, OpenRef continues with remaining sources. If no usable sources remain, it returns a graceful “insufficient web evidence” style outcome instead of fabricating unsupported claims.

## Why This Design Works

This runtime design is effective because it combines:

- Fast discovery (provider search)
- Robustness (fallbacks and partial-failure tolerance)
- Quality control (deduplication, diversity, relevance selection)
- Cost/latency governance (bounded candidates and token budgets)

In practice, OpenRef’s search behavior is optimized for answerability, not raw result count: it prefers fewer, stronger, and more diverse pages that can be cited confidently in final responses.
