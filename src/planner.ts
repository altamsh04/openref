import OpenAI from "openai";
import type { TokenUsage } from "./types";

const SYSTEM_PROMPT = `Expand the search query into 3 diverse search-engine queries. Output ONLY a JSON array of strings.`;

let clientCache: { key: string; client: OpenAI } | null = null;

function getClient(apiKey: string): OpenAI {
  if (clientCache?.key === apiKey) return clientCache.client;
  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  clientCache = { key: apiKey, client };
  return client;
}

export interface ExpandResult {
  queries: string[];
  tokenUsage: TokenUsage;
}

export async function expandQuery(
  query: string,
  apiKey: string,
  model: string
): Promise<ExpandResult> {
  const client = getClient(apiKey);
  const noTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Date: ${today}. Query: "${query}"` },
      ],
      temperature: 0.3,
      max_tokens: 120,
    });

    const tokenUsage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    const content = response.choices[0]?.message?.content?.trim() ?? "[]";

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.every((q) => typeof q === "string")) {
        return { queries: parsed, tokenUsage };
      }
    } catch {
      const matches = content.match(/"([^"]+)"/g);
      if (matches) return { queries: matches.map((m) => m.replace(/"/g, "")), tokenUsage };
    }

    return { queries: [query], tokenUsage };
  } catch {
    return { queries: [query], tokenUsage: noTokens };
  }
}
