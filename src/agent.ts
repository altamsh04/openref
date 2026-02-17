import type { OpenRefConfig, SearchResult, TokenUsage, ChatEvent } from "./types";
import { expandQuery } from "./planner";
import { searchWeb, searchAll } from "./search";
import { rankAndDedup } from "./ranker";
import { enrichWithMarkdown } from "./markdown";
import { streamChat } from "./chat";

const DEFAULTS = {
  model: "google/gemma-2-9b-it:free",
  chatModel: "",
  maxSources: 10,
  searchTimeout: 5000,
  expandQuery: true,
  fetchContent: false,
  contentTimeout: 8000,
  chat: false,
} as const;

const NO_TOKENS: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

export class OpenRef {
  private config: Required<OpenRefConfig>;

  constructor(config: OpenRefConfig) {
    this.config = {
      openRouterApiKey: config.openRouterApiKey,
      model: config.model ?? DEFAULTS.model,
      chatModel: config.chatModel || config.model || DEFAULTS.model,
      maxSources: config.maxSources ?? DEFAULTS.maxSources,
      searchTimeout: config.searchTimeout ?? DEFAULTS.searchTimeout,
      expandQuery: config.expandQuery ?? DEFAULTS.expandQuery,
      fetchContent: config.fetchContent ?? DEFAULTS.fetchContent,
      contentTimeout: config.contentTimeout ?? DEFAULTS.contentTimeout,
      chat: config.chat ?? DEFAULTS.chat,
    };
  }

  async search(query: string): Promise<SearchResult> {
    const start = performance.now();
    const timeout = this.config.searchTimeout;
    let tokenUsage = NO_TOKENS;
    let allQueries = [query];

    let allHits;

    if (this.config.expandQuery) {
      // LLM expansion + original search in parallel
      const [expandResult, originalHits] = await Promise.all([
        expandQuery(query, this.config.openRouterApiKey, this.config.model),
        searchWeb(query, timeout),
      ]);

      tokenUsage = expandResult.tokenUsage;

      const newQueries = expandResult.queries
        .filter((q) => q.toLowerCase() !== query.toLowerCase())
        .slice(0, 2);

      allHits = [...originalHits];

      if (newQueries.length > 0) {
        const expandedHits = await searchAll(newQueries, timeout);
        allHits = [...originalHits, ...expandedHits];
      }

      allQueries = [query, ...newQueries];
    } else {
      // Direct search — no LLM call
      allHits = await searchWeb(query, timeout);
    }

    let sources = rankAndDedup(allHits, this.config.maxSources);

    // Fetch markdown content if enabled
    if (this.config.fetchContent) {
      sources = await enrichWithMarkdown(sources, this.config.contentTimeout);
    }

    const latencyMs = Math.round(performance.now() - start);

    return {
      query,
      expandedQueries: allQueries,
      sources,
      metadata: {
        latencyMs,
        queriesExecuted: allQueries.length,
        totalResults: sources.length,
        tokenUsage,
      },
    };
  }

  async *chat(query: string): AsyncGenerator<ChatEvent> {
    // Step 1: search + fetch content
    const originalConfig = this.config.fetchContent;
    this.config.fetchContent = true;

    const result = await this.search(query);

    this.config.fetchContent = originalConfig;

    // Yield sources first
    yield { type: "sources", data: result };

    // Step 2: stream LLM response with sources as context
    let chatTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for await (const event of streamChat(
      query,
      result.sources,
      this.config.openRouterApiKey,
      this.config.chatModel
    )) {
      if (event.type === "text") {
        yield { type: "text", data: event.data };
      } else if (event.type === "usage") {
        chatTokenUsage = event.data;
      }
    }

    yield { type: "done", data: { chatTokenUsage } };
  }
}
