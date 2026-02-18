import type { TokenUsage, QueryIntent } from "./types";
import { getClient } from "./llmclient";

export interface ExpandResult {
  queries: string[];
  tokenUsage: TokenUsage;
}

export interface PlanResult {
  queries: string[];
  intent: QueryIntent;
  tokenUsage: TokenUsage;
}

const INTENT_PATTERNS: { intent: QueryIntent; patterns: RegExp[] }[] = [
  {
    intent: "current",
    patterns: [
      /\b(today|latest|current|now|recent|this\s+(week|month|year)|2025|2026|price|stock|news|update)\b/i,
    ],
  },
  {
    intent: "how-to",
    patterns: [
      /\b(how\s+to|tutorial|guide|step[- ]by[- ]step|setup|install|configure|implement)\b/i,
    ],
  },
  {
    intent: "factual",
    patterns: [
      /\b(what\s+is|who\s+is|define|definition|meaning|when\s+was|where\s+is|how\s+many|how\s+much)\b/i,
    ],
  },
  {
    intent: "research",
    patterns: [
      /\b(compare|vs\.?|versus|pros?\s+and\s+cons?|best|review|analysis|study|research|difference)\b/i,
    ],
  },
];

export function detectIntent(query: string): QueryIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(query))) return intent;
  }
  return "general";
}

function buildPlannerPrompt(intent: QueryIntent): string {
  const base =
    "Generate 3-5 diverse search-engine queries to thoroughly research the user's question. Output ONLY a JSON array of strings.";

  const intentGuidance: Record<QueryIntent, string> = {
    current:
      "Include at least one query with the current year. Focus on recent data and real-time information.",
    research:
      "Include one query targeting authoritative/academic sources. Cover different perspectives and comparisons.",
    factual:
      "Include one query targeting definitions and canonical sources. Also search for context and related facts.",
    "how-to":
      "Include queries targeting tutorials, official documentation, and practical examples from different sources.",
    general:
      "Cover different angles of the topic to ensure comprehensive results.",
  };

  return `${base}\n\nIntent: ${intent}. ${intentGuidance[intent]}`;
}

export async function planQuery(
  query: string,
  apiKey: string,
  model: string,
  options?: { maxExpansions?: number }
): Promise<PlanResult> {
  const client = getClient(apiKey);
  const noTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const intent = detectIntent(query);
  const maxExpansions = options?.maxExpansions ?? 4;

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildPlannerPrompt(intent) },
        { role: "user", content: `Date: ${today}. Query: "${query}"` },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const tokenUsage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    const content = response.choices[0]?.message?.content?.trim() ?? "[]";

    let queries: string[] = [];

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.every((q) => typeof q === "string")) {
        queries = parsed;
      }
    } catch {
      const matches = content.match(/"([^"]+)"/g);
      if (matches) queries = matches.map((m) => m.replace(/"/g, ""));
    }

    if (queries.length === 0) queries = [query];

    return {
      queries: queries.slice(0, maxExpansions),
      intent,
      tokenUsage,
    };
  } catch {
    return { queries: [query], intent, tokenUsage: noTokens };
  }
}

/** Backward-compatible wrapper */
export async function expandQuery(
  query: string,
  apiKey: string,
  model: string
): Promise<ExpandResult> {
  const result = await planQuery(query, apiKey, model);
  return { queries: result.queries, tokenUsage: result.tokenUsage };
}
