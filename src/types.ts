export interface OpenRefConfig {
  openRouterApiKey: string;
  model?: string;
  chatModel?: string;
  maxSources?: number;
  searchTimeout?: number;
  expandQuery?: boolean;
  fetchContent?: boolean;
  contentTimeout?: number;
  chat?: boolean;
}

export interface Source {
  url: string;
  title: string;
  domain: string;
  markdown?: string;
  markdownTokens?: number;
}

export interface SearchResult {
  query: string;
  expandedQueries: string[];
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
}

export type ChatEvent =
  | { type: "sources"; data: SearchResult }
  | { type: "text"; data: string }
  | { type: "done"; data: { chatTokenUsage: TokenUsage } };
