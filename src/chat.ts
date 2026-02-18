import type { Source, TokenUsage, ScoredChunk, CitationMap } from "./types";
import { getClient } from "./llmclient";

const SYSTEM_PROMPT = `You are a helpful research assistant. Answer the user's question based on the provided web sources. Be concise and accurate.

IMPORTANT: Cite your sources using [N] markers inline, where N corresponds to the source numbers listed. Every factual claim should have a citation. If the sources don't contain enough information, say so.`;

function assembleContext(chunks: ScoredChunk[], sources: Source[]): string {
  // Build source list
  const sourceLines = sources
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
    .join("\n");

  // Build excerpts grouped by source
  const excerptLines = chunks
    .map((chunk) => {
      const sourceNum = chunk.sourceIndex + 1;
      return `[${sourceNum}] ${chunk.content}`;
    })
    .join("\n\n");

  return `SOURCES:\n${sourceLines}\n\nEXCERPTS:\n${excerptLines}`;
}

function buildContext(sources: Source[]): string {
  return sources
    .filter((s) => s.markdown)
    .map((s, i) => `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\n\n${s.markdown}`)
    .join("\n\n---\n\n");
}

export function buildCitationMap(sources: Source[]): CitationMap {
  const map: CitationMap = {};
  sources.forEach((s, i) => {
    map[i + 1] = { url: s.url, title: s.title, domain: s.domain };
  });
  return map;
}

export async function* streamChat(
  query: string,
  sources: Source[],
  apiKey: string,
  model: string,
  chunks?: ScoredChunk[]
): AsyncGenerator<{ type: "text"; data: string } | { type: "usage"; data: TokenUsage }> {
  const client = getClient(apiKey);

  const context = chunks && chunks.length > 0
    ? assembleContext(chunks, sources)
    : buildContext(sources);

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

/** Non-streaming chat for deep research internal use */
export async function chatComplete(
  query: string,
  context: string,
  apiKey: string,
  model: string,
  systemPrompt?: string
): Promise<{ text: string; tokenUsage: TokenUsage }> {
  const client = getClient(apiKey);
  const noTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
        { role: "user", content: `## Web Sources\n\n${context}\n\n---\n\n## Question\n${query}` },
      ],
      temperature: 0.5,
      max_tokens: 1024,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    const tokenUsage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    return { text, tokenUsage };
  } catch {
    return { text: "", tokenUsage: noTokens };
  }
}
