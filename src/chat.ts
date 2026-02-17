import OpenAI from "openai";
import type { Source, TokenUsage } from "./types";

const SYSTEM_PROMPT = `You are a helpful research assistant. Answer the user's question based on the provided web sources. Be concise, accurate, and cite the source URLs when referencing information. If the sources don't contain enough information, say so.`;

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

function buildContext(sources: Source[]): string {
  return sources
    .filter((s) => s.markdown)
    .map((s, i) => `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\n\n${s.markdown}`)
    .join("\n\n---\n\n");
}

export interface ChatStreamResult {
  text: string;
  tokenUsage: TokenUsage;
}

export async function* streamChat(
  query: string,
  sources: Source[],
  apiKey: string,
  model: string
): AsyncGenerator<{ type: "text"; data: string } | { type: "usage"; data: TokenUsage }> {
  const client = getClient(apiKey);
  const context = buildContext(sources);

  if (!context) {
    yield { type: "text", data: "No content available from sources to answer the query." };
    yield { type: "usage", data: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    return;
  }

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `## Web Sources\n\n${context}\n\n---\n\n## Question\n${query}`,
      },
    ],
    temperature: 0.5,
    max_tokens: 1024,
  });

  let tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { type: "text", data: delta };

    if (chunk.usage) {
      tokenUsage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens: chunk.usage.total_tokens ?? 0,
      };
    }
  }

  yield { type: "usage", data: tokenUsage };
}
