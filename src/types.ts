export interface OpenRefConfig {
  openRouterApiKey: string;
  model?: string;
  chatModel?: string;
  maxSources?: number;
  searchTimeout?: number;
  fetchContent?: boolean;
  contentTimeout?: number;
  chat?: boolean;
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
  intent?: QueryIntent;
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

export type QueryIntent = "factual" | "research" | "current" | "how-to" | "general";

export type DeepResearchEvent =
  | { type: "iteration"; data: { pass: number; totalPasses: number; status: string } }
  | { type: "sources"; data: SearchResult }
  | { type: "text"; data: string }
  | { type: "done"; data: { chatTokenUsage: TokenUsage; citationMap: CitationMap; iterations: number } };

export type ChatEvent =
  | { type: "sources"; data: SearchResult }
  | { type: "text"; data: string }
  | { type: "citations"; data: CitationMap }
  | { type: "done"; data: { chatTokenUsage: TokenUsage; citationMap: CitationMap } };
