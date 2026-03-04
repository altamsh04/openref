export interface OpenRefLLMConfig {
  apiKey?: string;
  chatModel?: string;
  fallbackChatModels?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
  maxOutputTokens?: number;
  maxContinuationRequests?: number;
  systemPrompt?: string;
  citationStrictness?: boolean;
}

export type SearchProvider = "brave" | "duckduckgo" | "bing" | "searxng" | "searxncg";

export interface OpenRefEngineProviderConfig {
  provider?: SearchProvider | SearchProvider[];
  queryUrl?: string;
}

export interface OpenRefSearchConfig {
  preferLatest?: boolean;
  timeZone?: string;
  maxSources?: number;
  searchTimeout?: number;
  enableReranking?: boolean;
  rerankTimeout?: number;
  queryExpansion?: boolean;
  queryExpansionValue?: number;
  queryExpansionTimeout?: number;
  engineProvider?: OpenRefEngineProviderConfig;
}

export interface OpenRefRetrievalConfig {
  contentTimeout?: number;
  maxContextTokens?: number;
  chunkTargetTokens?: number;
}

export interface OpenRefResponseConfig {
  stream?: boolean;
}

export interface OpenRefConfig {
  llm?: OpenRefLLMConfig;
  search?: OpenRefSearchConfig;
  retrieval?: OpenRefRetrievalConfig;
  response?: OpenRefResponseConfig;

  // Legacy top-level fields (supported for backward compatibility)
  openRouterApiKey?: string;
  stream?: boolean;
  systemPrompt?: string;
  citationStrictness?: boolean;
  preferLatest?: boolean;
  timeZone?: string;
  queryExpansion?: boolean;
  queryExpansionValue?: number;
  queryExpansionTimeout?: number;
  engineProvider?: OpenRefEngineProviderConfig;
  chatModel?: string;
  fallbackChatModels?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
  maxOutputTokens?: number;
  maxContinuationRequests?: number;
  maxSources?: number;
  searchTimeout?: number;
  contentTimeout?: number;
  enableReranking?: boolean;
  rerankTimeout?: number;
  maxContextTokens?: number;
  chunkTargetTokens?: number;
}

export interface Source {
  url: string;
  title: string;
  domain: string;
  markdown?: string;
  markdownTokens?: number;
  relevanceScore?: number;
}

export interface SearchResult {
  query: string;
  sources: Source[];
  metadata: SearchMetadata;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SearchMetadata {
  latencyMs: number;
  queriesExecuted: number;
  totalResults: number;
  expandedQueries?: string[];
  primaryProviderUsed?: SearchProvider;
  providersUsed?: SearchProvider[];
  tokenUsage: TokenUsage;
}

export interface RawSearchHit {
  url: string;
  title: string;
  snippet?: string;
  querySource?: string;
  provider?: SearchProvider;
}

export interface Chunk {
  content: string;
  tokenEstimate: number;
  sourceIndex: number;
  chunkIndex: number;
}

export interface ScoredChunk extends Chunk {
  score: number;
}

export interface CitationMap {
  [N: number]: { url: string; title: string; domain: string };
}

export interface ChatOptions {
  stream?: boolean;
  systemPrompt?: string;
  citationStrictness?: boolean;
}

export interface ChatResponse {
  query: string;
  sources: Source[];
  text: string;
  citationMap: CitationMap;
  metadata: SearchMetadata;
  chatTokenUsage: TokenUsage;
}

export type ChatEvent =
  | { type: "expanded_queries"; data: string[] }
  | { type: "sources"; data: SearchResult }
  | { type: "text"; data: string }
  | { type: "citations"; data: CitationMap }
  | { type: "done"; data: { chatTokenUsage: TokenUsage; citationMap: CitationMap } };
