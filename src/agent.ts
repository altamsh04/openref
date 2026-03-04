import type {
  OpenRefConfig,
  SearchResult,
  TokenUsage,
  ChatOptions,
  ChatResponse,
  ChatEvent,
  RawSearchHit,
  Source,
  SearchProvider,
} from "./types";
import { ALL_SEARCH_PROVIDERS, searchAll, searchWeb } from "./search";
import { fastFilter, llmRerank } from "./ranker";
import { fetchAndChunk } from "./markdown";
import { streamChat, buildCitationMap } from "./chat";
import { expandQuery } from "./queryexpander";

const DEFAULTS = {
  stream: true,
  systemPrompt: "",
  citationStrictness: true,
  preferLatest: true,
  timeZone: "UTC",
  chatModel: "nvidia/nemotron-3-nano-30b-a3b:free",
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
  queryExpansion: false,
  queryExpansionValue: 3,
  queryExpansionTimeout: 1200,
  searchProvider: "brave" as SearchProvider,
  searchProviderQueryUrl: "",
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
} as const;

const NO_TOKENS: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

interface ResolvedOpenRefConfig {
  openRouterApiKey: string;
  stream: boolean;
  systemPrompt: string;
  citationStrictness: boolean;
  preferLatest: boolean;
  timeZone: string;
  chatModel: string;
  fallbackChatModels: string[];
  maxRetries: number;
  retryDelayMs: number;
  maxOutputTokens: number;
  maxContinuationRequests: number;
  maxSources: number;
  searchTimeout: number;
  contentTimeout: number;
  enableReranking: boolean;
  rerankTimeout: number;
  queryExpansion: boolean;
  queryExpansionValue: number;
  queryExpansionTimeout: number;
  searchProviders: SearchProvider[];
  searchProviderQueryUrl: string;
  maxContextTokens: number;
  chunkTargetTokens: number;
}

function pickDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function resolveSearchProviders(
  providerInput: SearchProvider | SearchProvider[] | undefined,
  defaultPrimary: SearchProvider
): SearchProvider[] {
  const fallbackProviders: SearchProvider[] = ["brave", "duckduckgo", "bing"];
  const preferred = Array.isArray(providerInput) ? providerInput : [providerInput ?? defaultPrimary];
  const ordered: SearchProvider[] = [];

  for (const provider of preferred) {
    if (ALL_SEARCH_PROVIDERS.includes(provider) && !ordered.includes(provider)) {
      ordered.push(provider);
    }
  }

  for (const provider of fallbackProviders) {
    if (!ordered.includes(provider)) ordered.push(provider);
  }

  return ordered;
}

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

const STREAM_SANITIZE_TAIL = 48;

function removeCitationMarkers(text: string): string {
  return text
    // Common citation marker variants from different model styles.
    .replace(/\s*\[\d+\]/g, "")
    .replace(/\s*\[\d+†[^\]]*]/g, "")
    .replace(/\s*【\d+】/g, "")
    .replace(/\s*【\d+†[^】]*】/g, "")
    // Broad fallback: bracketed numeric citations with optional trailing metadata.
    .replace(/\s*[\[【]\s*\d+(?:[^\]】]{0,24})?[\]】]/g, "");
}

function stripInlineCitations(text: string): string {
  return removeCitationMarkers(text)
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, timeoutMs);
    promise
      .then((value) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(value);
        }
      })
      .catch(() => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      });
  });
}

export class OpenRef {
  private config: ResolvedOpenRefConfig;

  constructor(config: OpenRefConfig) {
    const openRouterApiKey = pickDefined(config?.llm?.apiKey, config?.openRouterApiKey)?.trim();
    if (!openRouterApiKey) {
      throw new Error("OpenRouter API key is required. Provide llm.apiKey (preferred) or openRouterApiKey (legacy).");
    }

    this.config = {
      openRouterApiKey,
      stream: pickDefined(config.response?.stream, config.stream, DEFAULTS.stream)!,
      systemPrompt: pickDefined(config.llm?.systemPrompt, config.systemPrompt, DEFAULTS.systemPrompt)!,
      citationStrictness: pickDefined(
        config.llm?.citationStrictness,
        config.citationStrictness,
        DEFAULTS.citationStrictness
      )!,
      preferLatest: pickDefined(config.search?.preferLatest, config.preferLatest, DEFAULTS.preferLatest)!,
      timeZone: pickDefined(config.search?.timeZone, config.timeZone, DEFAULTS.timeZone)!,
      chatModel: pickDefined(config.llm?.chatModel, config.chatModel, DEFAULTS.chatModel)!,
      fallbackChatModels: pickDefined(
        config.llm?.fallbackChatModels,
        config.fallbackChatModels,
        DEFAULTS.fallbackChatModels
      )!,
      maxRetries: pickDefined(config.llm?.maxRetries, config.maxRetries, DEFAULTS.maxRetries)!,
      retryDelayMs: pickDefined(config.llm?.retryDelayMs, config.retryDelayMs, DEFAULTS.retryDelayMs)!,
      maxOutputTokens: pickDefined(config.llm?.maxOutputTokens, config.maxOutputTokens, DEFAULTS.maxOutputTokens)!,
      maxContinuationRequests: pickDefined(
        config.llm?.maxContinuationRequests,
        config.maxContinuationRequests,
        DEFAULTS.maxContinuationRequests
      )!,
      maxSources: pickDefined(config.search?.maxSources, config.maxSources, DEFAULTS.maxSources)!,
      searchTimeout: pickDefined(config.search?.searchTimeout, config.searchTimeout, DEFAULTS.searchTimeout)!,
      contentTimeout: pickDefined(config.retrieval?.contentTimeout, config.contentTimeout, DEFAULTS.contentTimeout)!,
      enableReranking: pickDefined(
        config.search?.enableReranking,
        config.enableReranking,
        DEFAULTS.enableReranking
      )!,
      rerankTimeout: pickDefined(config.search?.rerankTimeout, config.rerankTimeout, DEFAULTS.rerankTimeout)!,
      queryExpansion: pickDefined(config.search?.queryExpansion, config.queryExpansion, DEFAULTS.queryExpansion)!,
      queryExpansionValue: Math.max(
        0,
        Math.min(
          5,
          pickDefined(config.search?.queryExpansionValue, config.queryExpansionValue, DEFAULTS.queryExpansionValue)!
        )
      ),
      queryExpansionTimeout: pickDefined(
        config.search?.queryExpansionTimeout,
        config.queryExpansionTimeout,
        DEFAULTS.queryExpansionTimeout
      )!,
      searchProviders: resolveSearchProviders(
        pickDefined(config.search?.engineProvider?.provider, config.engineProvider?.provider),
        DEFAULTS.searchProvider
      ),
      searchProviderQueryUrl: (pickDefined(
        config.search?.engineProvider?.queryUrl,
        config.engineProvider?.queryUrl,
        DEFAULTS.searchProviderQueryUrl
      ) ?? "").trim(),
      maxContextTokens: pickDefined(
        config.retrieval?.maxContextTokens,
        config.maxContextTokens,
        DEFAULTS.maxContextTokens
      )!,
      chunkTargetTokens: pickDefined(
        config.retrieval?.chunkTargetTokens,
        config.chunkTargetTokens,
        DEFAULTS.chunkTargetTokens
      )!,
    };
  }

  private async executeSearch(
    query: string,
    dateCtx: { year: string; monthYear: string; dateLabel: string }
  ): Promise<{
    sources: Source[];
    expandedQueries: string[];
    queriesExecuted: number;
    primaryProviderUsed?: SearchProvider;
    providersUsed: SearchProvider[];
  }> {
    const timeout = this.config.searchTimeout;
    const queryForSearch = this.config.preferLatest ? buildLatestAwareQuery(query, dateCtx) : query;

    const initialSearchPromise = searchWeb(
      queryForSearch,
      timeout,
      this.config.searchProviders,
      this.config.searchProviderQueryUrl
    );
    const expansionPromise = this.config.queryExpansion
      ? expandQuery(
          query,
          this.config.openRouterApiKey,
          this.config.chatModel,
          this.config.queryExpansionValue,
          this.config.queryExpansionTimeout,
          this.config.preferLatest,
          dateCtx.dateLabel
        )
      : Promise.resolve([] as string[]);

    const expandedQueriesPromise = withTimeout(expansionPromise, this.config.queryExpansionTimeout, [] as string[]);
    const expandedSearchPromise = expandedQueriesPromise.then(async (expandedQueries) => {
      if (expandedQueries.length === 0) {
        return {
          expandedQueries,
          expandedSearchQueries: [] as string[],
          expandedHits: [] as RawSearchHit[],
        };
      }

      const expandedSearchQueries = expandedQueries.map((q) =>
        this.config.preferLatest ? buildLatestAwareQuery(q, dateCtx) : q
      );
      const expandedHits = await searchAll(
        expandedSearchQueries,
        timeout,
        this.config.searchProviders,
        this.config.searchProviderQueryUrl
      );
      return { expandedQueries, expandedSearchQueries, expandedHits };
    });

    const [initialHits, expandedSearchResult] = await Promise.all([
      initialSearchPromise,
      expandedSearchPromise,
    ]);
    const { expandedQueries, expandedSearchQueries, expandedHits } = expandedSearchResult;

    let allHits: RawSearchHit[] = [...initialHits, ...expandedHits];

    // Resilience fallback: if date-biased or timed requests returned nothing,
    // retry once with plain queries and a slightly longer timeout.
    if (allHits.length === 0) {
      const retryTimeout = Math.max(timeout, 8000);
      const retryInitial = await searchWeb(
        query,
        retryTimeout,
        this.config.searchProviders,
        this.config.searchProviderQueryUrl
      );
      const retryExpanded = expandedQueries.length > 0
        ? await searchAll(
            expandedQueries,
            retryTimeout,
            this.config.searchProviders,
            this.config.searchProviderQueryUrl
          )
        : [];
      allHits = [...retryInitial, ...retryExpanded];
    }

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

    const providersUsed: SearchProvider[] = [];
    for (const hit of allHits) {
      const provider = hit.provider;
      if (!provider) continue;
      if (!providersUsed.includes(provider)) providersUsed.push(provider);
    }
    const primaryProviderUsed = providersUsed[0];

    return {
      sources,
      expandedQueries,
      queriesExecuted: 1 + expandedSearchQueries.length,
      primaryProviderUsed,
      providersUsed,
    };
  }

  async search(query: string): Promise<SearchResult> {
    assertValidQuery(query);

    const start = performance.now();
    const dateCtx = getDateContext(this.config.timeZone);
    const { sources, expandedQueries, queriesExecuted, primaryProviderUsed, providersUsed } = await this.executeSearch(
      query,
      dateCtx
    );

    return {
      query,
      sources,
      metadata: {
        latencyMs: Math.round(performance.now() - start),
        queriesExecuted,
        totalResults: sources.length,
        expandedQueries,
        primaryProviderUsed,
        providersUsed,
        tokenUsage: NO_TOKENS,
      },
    };
  }

  chat(query: string, options?: ChatOptions & { stream?: true }): AsyncGenerator<ChatEvent>;
  chat(query: string, options: ChatOptions & { stream: false }): Promise<ChatResponse>;
  chat(query: string, options: ChatOptions = {}): AsyncGenerator<ChatEvent> | Promise<ChatResponse> {
    const stream = options.stream ?? this.config.stream;
    if (!stream) return this.chatNonStream(query, options);
    return this.chatStream(query, options);
  }

  private async *chatStream(query: string, options: ChatOptions = {}): AsyncGenerator<ChatEvent> {
    assertValidQuery(query);
    const dateCtx = getDateContext(this.config.timeZone);

    const result = await this.search(query);
    if (result.metadata.expandedQueries && result.metadata.expandedQueries.length > 0) {
      yield { type: "expanded_queries", data: result.metadata.expandedQueries };
    }
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
    const citationStrictness = options?.citationStrictness ?? this.config.citationStrictness;
    let citationBuffer = "";

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
        systemPrompt: options?.systemPrompt ?? this.config.systemPrompt,
        citationStrictness,
        fallbackModels: this.config.fallbackChatModels,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
      }
    )) {
      if (event.type === "text") {
        if (citationStrictness) {
          if (event.data.length > 0) {
            yield { type: "text", data: event.data };
          }
        } else {
          citationBuffer += event.data;
          if (citationBuffer.length > STREAM_SANITIZE_TAIL) {
            const flushLength = citationBuffer.length - STREAM_SANITIZE_TAIL;
            const flushChunk = citationBuffer.slice(0, flushLength);
            citationBuffer = citationBuffer.slice(flushLength);
            const sanitized = removeCitationMarkers(flushChunk);
            if (sanitized.length > 0) {
              yield { type: "text", data: sanitized };
            }
          }
        }
      } else if (event.type === "usage") {
        chatTokenUsage = event.data;
      }
    }

    if (!citationStrictness && citationBuffer.length > 0) {
      const sanitized = removeCitationMarkers(citationBuffer);
      if (sanitized.length > 0) {
        yield { type: "text", data: sanitized };
      }
    }

    yield { type: "citations", data: citationMap };
    yield { type: "done", data: { chatTokenUsage, citationMap } };
  }

  private async chatNonStream(query: string, options: ChatOptions = {}): Promise<ChatResponse> {
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
    const citationStrictness = options?.citationStrictness ?? this.config.citationStrictness;

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
        systemPrompt: options?.systemPrompt ?? this.config.systemPrompt,
        citationStrictness,
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

    if (!citationStrictness) {
      text = stripInlineCitations(text);
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
