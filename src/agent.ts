import type {
  OpenRefConfig,
  SearchResult,
  TokenUsage,
  ChatOptions,
  ChatResponse,
  ChatEvent,
  RawSearchHit,
} from "./types";
import { searchWeb } from "./search";
import { fastFilter, llmRerank } from "./ranker";
import { fetchAndChunk } from "./markdown";
import { streamChat, buildCitationMap } from "./chat";

const DEFAULTS = {
  stream: true,
  preferLatest: true,
  timeZone: "UTC",
  chatModel: "google/gemma-2-9b-it:free",
  fallbackChatModels: [] as string[],
  maxRetries: 2,
  retryDelayMs: 1200,
  maxOutputTokens: 2048,
  maxContinuationRequests: 2,
  maxSources: 10,
  searchTimeout: 5000,
  contentTimeout: 6000,
  enableReranking: true,
  rerankTimeout: 4000,
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
} as const;

const NO_TOKENS: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function assertValidQuery(query: string): void {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Query must be a non-empty string.");
  }
}

function getDateContext(timeZone: string): { year: string; monthYear: string; dateLabel: string } {
  const now = new Date();
  const monthYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone }).format(now);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(now);
  return { year: String(now.getUTCFullYear()), monthYear, dateLabel };
}

function buildLatestAwareQuery(query: string, dateCtx: { year: string; monthYear: string; dateLabel: string }): string {
  return `${query} latest updates ${dateCtx.year} ${dateCtx.monthYear} as of ${dateCtx.dateLabel}`;
}

export class OpenRef {
  private config: Required<OpenRefConfig>;

  constructor(config: OpenRefConfig) {
    if (!config?.openRouterApiKey?.trim()) {
      throw new Error("openRouterApiKey is required.");
    }

    this.config = {
      openRouterApiKey: config.openRouterApiKey,
      stream: config.stream ?? DEFAULTS.stream,
      preferLatest: config.preferLatest ?? DEFAULTS.preferLatest,
      timeZone: config.timeZone ?? DEFAULTS.timeZone,
      chatModel: config.chatModel ?? DEFAULTS.chatModel,
      fallbackChatModels: config.fallbackChatModels ?? DEFAULTS.fallbackChatModels,
      maxRetries: config.maxRetries ?? DEFAULTS.maxRetries,
      retryDelayMs: config.retryDelayMs ?? DEFAULTS.retryDelayMs,
      maxOutputTokens: config.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
      maxContinuationRequests: config.maxContinuationRequests ?? DEFAULTS.maxContinuationRequests,
      maxSources: config.maxSources ?? DEFAULTS.maxSources,
      searchTimeout: config.searchTimeout ?? DEFAULTS.searchTimeout,
      contentTimeout: config.contentTimeout ?? DEFAULTS.contentTimeout,
      enableReranking: config.enableReranking ?? DEFAULTS.enableReranking,
      rerankTimeout: config.rerankTimeout ?? DEFAULTS.rerankTimeout,
      maxContextTokens: config.maxContextTokens ?? DEFAULTS.maxContextTokens,
      chunkTargetTokens: config.chunkTargetTokens ?? DEFAULTS.chunkTargetTokens,
    };
  }

  async search(query: string): Promise<SearchResult> {
    assertValidQuery(query);

    const start = performance.now();
    const timeout = this.config.searchTimeout;
    const dateCtx = getDateContext(this.config.timeZone);
    const queryForSearch = this.config.preferLatest ? buildLatestAwareQuery(query, dateCtx) : query;
    const allHits: RawSearchHit[] = await searchWeb(queryForSearch, timeout);

    const candidates = fastFilter(allHits, 30);

    const snippetMap = new Map<string, string>();
    for (const hit of allHits) {
      if (hit.snippet && !snippetMap.has(hit.url)) {
        snippetMap.set(hit.url, hit.snippet);
      }
    }

    const sources =
      this.config.enableReranking && candidates.length > this.config.maxSources
        ? await llmRerank(
            query,
            candidates,
            snippetMap,
            this.config.openRouterApiKey,
            this.config.chatModel,
            this.config.maxSources,
            this.config.rerankTimeout,
            this.config.preferLatest,
            dateCtx.dateLabel
          )
        : candidates.slice(0, this.config.maxSources);

    return {
      query,
      sources,
      metadata: {
        latencyMs: Math.round(performance.now() - start),
        queriesExecuted: 1,
        totalResults: sources.length,
        tokenUsage: NO_TOKENS,
      },
    };
  }

  chat(query: string, options?: ChatOptions & { stream?: true }): AsyncGenerator<ChatEvent>;
  chat(query: string, options: ChatOptions & { stream: false }): Promise<ChatResponse>;
  chat(query: string, options: ChatOptions = {}): AsyncGenerator<ChatEvent> | Promise<ChatResponse> {
    const stream = options.stream ?? this.config.stream;
    if (!stream) return this.chatNonStream(query);
    return this.chatStream(query);
  }

  private async *chatStream(query: string): AsyncGenerator<ChatEvent> {
    assertValidQuery(query);
    const dateCtx = getDateContext(this.config.timeZone);

    const result = await this.search(query);
    yield { type: "sources", data: result };

    if (result.sources.length === 0) {
      const citationMap = buildCitationMap([]);
      yield { type: "text", data: "No web sources found for the query." };
      yield { type: "citations", data: citationMap };
      yield { type: "done", data: { chatTokenUsage: NO_TOKENS, citationMap } };
      return;
    }

    const { chunks, enrichedSources } = await fetchAndChunk(
      result.sources,
      query,
      [],
      this.config.contentTimeout,
      this.config.maxContextTokens,
      this.config.chunkTargetTokens
    );

    result.sources = enrichedSources;
    const citationMap = buildCitationMap(result.sources);

    let chatTokenUsage: TokenUsage = { ...NO_TOKENS };

    for await (const event of streamChat(
      query,
      result.sources,
      this.config.openRouterApiKey,
      this.config.chatModel,
      chunks,
      {
        maxOutputTokens: this.config.maxOutputTokens,
        maxContinuationRequests: this.config.maxContinuationRequests,
        preferLatest: this.config.preferLatest,
        currentDateTime: dateCtx.dateLabel,
        fallbackModels: this.config.fallbackChatModels,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
      }
    )) {
      if (event.type === "text") {
        yield { type: "text", data: event.data };
      } else if (event.type === "usage") {
        chatTokenUsage = event.data;
      }
    }

    yield { type: "citations", data: citationMap };
    yield { type: "done", data: { chatTokenUsage, citationMap } };
  }

  private async chatNonStream(query: string): Promise<ChatResponse> {
    assertValidQuery(query);
    const dateCtx = getDateContext(this.config.timeZone);

    const result = await this.search(query);

    if (result.sources.length === 0) {
      const citationMap = buildCitationMap([]);
      return {
        query: result.query,
        sources: result.sources,
        text: "No web sources found for the query.",
        citationMap,
        metadata: result.metadata,
        chatTokenUsage: NO_TOKENS,
      };
    }

    const { chunks, enrichedSources } = await fetchAndChunk(
      result.sources,
      query,
      [],
      this.config.contentTimeout,
      this.config.maxContextTokens,
      this.config.chunkTargetTokens
    );

    result.sources = enrichedSources;
    const citationMap = buildCitationMap(result.sources);

    let text = "";
    let chatTokenUsage: TokenUsage = { ...NO_TOKENS };

    for await (const event of streamChat(
      query,
      result.sources,
      this.config.openRouterApiKey,
      this.config.chatModel,
      chunks,
      {
        maxOutputTokens: this.config.maxOutputTokens,
        maxContinuationRequests: this.config.maxContinuationRequests,
        preferLatest: this.config.preferLatest,
        currentDateTime: dateCtx.dateLabel,
        fallbackModels: this.config.fallbackChatModels,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
      }
    )) {
      if (event.type === "text") {
        text += event.data;
      } else if (event.type === "usage") {
        chatTokenUsage = event.data;
      }
    }

    return {
      query: result.query,
      sources: result.sources,
      text,
      citationMap,
      metadata: result.metadata,
      chatTokenUsage,
    };
  }
}
