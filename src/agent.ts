import type {
  OpenRefConfig,
  Source,
  SearchResult,
  TokenUsage,
  ChatEvent,
  DeepResearchEvent,
  CitationMap,
  ScoredChunk,
  QueryIntent,
  RawSearchHit,
} from "./types";
import { detectIntent } from "./planner";
import { searchWeb, searchAll } from "./search";
import { fastFilter, llmRerank } from "./ranker";
import { enrichWithMarkdown, fetchAndChunk } from "./markdown";
import { streamChat, chatComplete, buildCitationMap } from "./chat";

const DEFAULTS = {
  model: "google/gemma-2-9b-it:free",
  chatModel: "",
  maxSources: 10,
  searchTimeout: 5000,
  fetchContent: false,
  contentTimeout: 6000,
  chat: false,
  enableReranking: true,
  rerankTimeout: 4000,
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
} as const;

const NO_TOKENS: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export class OpenRef {
  private config: Required<OpenRefConfig>;

  constructor(config: OpenRefConfig) {
    this.config = {
      openRouterApiKey: config.openRouterApiKey,
      model: config.model ?? DEFAULTS.model,
      chatModel: config.chatModel || config.model || DEFAULTS.model,
      maxSources: config.maxSources ?? DEFAULTS.maxSources,
      searchTimeout: config.searchTimeout ?? DEFAULTS.searchTimeout,
      fetchContent: config.fetchContent ?? DEFAULTS.fetchContent,
      contentTimeout: config.contentTimeout ?? DEFAULTS.contentTimeout,
      chat: config.chat ?? DEFAULTS.chat,
      enableReranking: config.enableReranking ?? DEFAULTS.enableReranking,
      rerankTimeout: config.rerankTimeout ?? DEFAULTS.rerankTimeout,
      maxContextTokens: config.maxContextTokens ?? DEFAULTS.maxContextTokens,
      chunkTargetTokens: config.chunkTargetTokens ?? DEFAULTS.chunkTargetTokens,
    };
  }

  async search(query: string): Promise<SearchResult> {
    const start = performance.now();
    const timeout = this.config.searchTimeout;
    const intent: QueryIntent = detectIntent(query);
    const allHits: RawSearchHit[] = await searchWeb(query, timeout);

    // Fast filter → LLM rerank
    const candidates = fastFilter(allHits, 30);

    // Build snippet map for reranking
    const snippetMap = new Map<string, string>();
    for (const hit of allHits) {
      if (hit.snippet && !snippetMap.has(hit.url)) {
        snippetMap.set(hit.url, hit.snippet);
      }
    }

    let sources;
    if (this.config.enableReranking && candidates.length > this.config.maxSources) {
      sources = await llmRerank(
        query,
        candidates,
        snippetMap,
        this.config.openRouterApiKey,
        this.config.model,
        this.config.maxSources,
        this.config.rerankTimeout
      );
    } else {
      sources = candidates.slice(0, this.config.maxSources);
    }

    // Fetch markdown content if enabled (backward compat)
    if (this.config.fetchContent) {
      sources = await enrichWithMarkdown(sources, this.config.contentTimeout);
    }

    const latencyMs = Math.round(performance.now() - start);

    return {
      query,
      sources,
      intent,
      metadata: {
        latencyMs,
        queriesExecuted: 1,
        totalResults: sources.length,
        tokenUsage: NO_TOKENS,
      },
    };
  }

  async *chat(query: string): AsyncGenerator<ChatEvent> {
    // Step 1: search
    const result = await this.search(query);

    // Yield sources first
    yield { type: "sources", data: result };

    // Step 2: fetch + chunk for smart context
    const { chunks, enrichedSources } = await fetchAndChunk(
      result.sources,
      query,
      [],
      this.config.contentTimeout,
      this.config.maxContextTokens,
      this.config.chunkTargetTokens
    );

    // Update sources with fetched content
    result.sources = enrichedSources;

    // Build citation map
    const citationMap = buildCitationMap(result.sources);

    // Step 3: stream LLM response with chunks as context
    let chatTokenUsage: TokenUsage = { ...NO_TOKENS };

    for await (const event of streamChat(
      query,
      result.sources,
      this.config.openRouterApiKey,
      this.config.chatModel,
      chunks
    )) {
      if (event.type === "text") {
        yield { type: "text", data: event.data };
      } else if (event.type === "usage") {
        chatTokenUsage = event.data;
      }
    }

    // Yield citation map
    yield { type: "citations", data: citationMap };

    yield { type: "done", data: { chatTokenUsage, citationMap } };
  }

  async *deepResearch(
    query: string,
    options?: { maxPasses?: number; wallClockTimeout?: number }
  ): AsyncGenerator<DeepResearchEvent> {
    const maxPasses = options?.maxPasses ?? 2;
    const wallClockTimeout = options?.wallClockTimeout ?? 45000;
    const startTime = performance.now();

    let allChunks: ScoredChunk[] = [];
    let lastResult: SearchResult | undefined;
    let totalTokenUsage: TokenUsage = { ...NO_TOKENS };
    let currentAnswer = "";

    for (let pass = 0; pass <= maxPasses; pass++) {
      // Check wall clock timeout
      if (performance.now() - startTime > wallClockTimeout) break;

      yield {
        type: "iteration",
        data: {
          pass,
          totalPasses: maxPasses + 1,
          status: pass === 0 ? "Initial research" : `Refinement pass ${pass}`,
        },
      };

      if (pass === 0) {
        // Pass 0: Full pipeline — search + chunk
        const result = await this.search(query);
        lastResult = result;

        yield { type: "sources", data: result };

        const { chunks } = await fetchAndChunk(
          result.sources,
          query,
          [],
          this.config.contentTimeout,
          this.config.maxContextTokens,
          this.config.chunkTargetTokens
        );

        allChunks = chunks;

        // Generate initial answer (non-streaming)
        const context = this.buildDeepContext(allChunks, lastResult.sources);
        const { text, tokenUsage } = await chatComplete(
          query,
          context,
          this.config.openRouterApiKey,
          this.config.chatModel
        );

        currentAnswer = text;
        totalTokenUsage = addTokens(totalTokenUsage, tokenUsage);
        totalTokenUsage = addTokens(totalTokenUsage, result.metadata.tokenUsage);
      } else {
        // Pass 1-N: Critique → find gaps → search gaps → merge chunks → regenerate
        const critiquePrompt = `Review this answer about "${query}" and identify 1-3 specific information gaps or areas that need more detail. Output ONLY a JSON array of search queries that would fill these gaps.\n\nAnswer:\n${currentAnswer}`;

        const { text: critiqueText, tokenUsage: critiqueTokens } = await chatComplete(
          critiquePrompt,
          "",
          this.config.openRouterApiKey,
          this.config.model,
          "You identify gaps in research answers. Output ONLY a JSON array of search query strings."
        );

        totalTokenUsage = addTokens(totalTokenUsage, critiqueTokens);

        // Parse gap queries
        let gapQueries: string[] = [];
        try {
          const parsed = JSON.parse(critiqueText);
          if (Array.isArray(parsed)) {
            gapQueries = parsed.filter((q): q is string => typeof q === "string").slice(0, 3);
          }
        } catch {
          const matches = critiqueText.match(/"([^"]+)"/g);
          if (matches) gapQueries = matches.map((m) => m.replace(/"/g, "")).slice(0, 3);
        }

        if (gapQueries.length === 0) break; // No gaps found, we're done

        // Search for gaps
        const gapHits = await searchAll(gapQueries, this.config.searchTimeout);
        const gapSources = fastFilter(gapHits, 10)
          .filter((s) => !lastResult!.sources.some((existing) => existing.url === s.url));

        if (gapSources.length > 0) {
          const { chunks: gapChunks } = await fetchAndChunk(
            gapSources,
            query,
            gapQueries,
            this.config.contentTimeout,
            this.config.maxContextTokens / 2,
            this.config.chunkTargetTokens
          );

          // Reindex gap chunks to avoid conflicts
          const offset = lastResult!.sources.length;
          const reindexed = gapChunks.map((c) => ({ ...c, sourceIndex: c.sourceIndex + offset }));

          allChunks = [...allChunks, ...reindexed];
          lastResult = {
            ...lastResult!,
            sources: [...lastResult!.sources, ...gapSources],
          };
        }

        // Regenerate answer with enriched context
        const context = this.buildDeepContext(allChunks, lastResult!.sources);
        const { text, tokenUsage } = await chatComplete(
          query,
          context,
          this.config.openRouterApiKey,
          this.config.chatModel
        );

        currentAnswer = text;
        totalTokenUsage = addTokens(totalTokenUsage, tokenUsage);
      }
    }

    // Final: stream the refined answer
    for (const char of currentAnswer) {
      yield { type: "text", data: char };
    }

    const citationMap = buildCitationMap(lastResult?.sources ?? []);

    yield {
      type: "done",
      data: {
        chatTokenUsage: totalTokenUsage,
        citationMap,
        iterations: Math.min(maxPasses + 1, Math.ceil((performance.now() - startTime) / 1000)),
      },
    };
  }

  private buildDeepContext(chunks: ScoredChunk[], sources: Source[]): string {
    const sourceLines = sources
      .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
      .join("\n");

    const excerptLines = chunks
      .map((chunk) => `[${chunk.sourceIndex + 1}] ${chunk.content}`)
      .join("\n\n");

    return `SOURCES:\n${sourceLines}\n\nEXCERPTS:\n${excerptLines}`;
  }
}
