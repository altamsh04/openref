export interface OpenRefConfig {
  openRouterApiKey: string;
  stream?: boolean;
  chatModel?: string;
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
  tokenUsage: TokenUsage;
}

export interface RawSearchHit {
  url: string;
  title: string;
  snippet?: string;
  querySource?: string;
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
  | { type: "sources"; data: SearchResult }
  | { type: "text"; data: string }
  | { type: "citations"; data: CitationMap }
  | { type: "done"; data: { chatTokenUsage: TokenUsage; citationMap: CitationMap } };
