import type { Source, TokenUsage, ScoredChunk, CitationMap } from "./types";
import { getClient } from "./llmclient";

const SYSTEM_PROMPT = `You are a helpful research assistant. Answer the user's question based on the provided web sources. Be concise and accurate.

IMPORTANT: Cite your sources using [N] markers inline, where N corresponds to the source numbers listed. Every factual claim should have a citation. If the sources don't contain enough information, say so.`;
const CONTINUE_PROMPT =
  "Continue exactly from where you stopped. Do not repeat earlier text. Keep citations consistent.";
const NO_TOKENS: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_MAX_CONTINUATION_REQUESTS = 2;

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

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
  chunks?: ScoredChunk[],
  options?: {
    maxOutputTokens?: number;
    maxContinuationRequests?: number;
    preferLatest?: boolean;
    currentDateTime?: string;
    fallbackModels?: string[];
    maxRetries?: number;
    retryDelayMs?: number;
  }
): AsyncGenerator<{ type: "text"; data: string } | { type: "usage"; data: TokenUsage }> {
  const client = getClient(apiKey);
  const maxOutputTokens = options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxContinuationRequests =
    options?.maxContinuationRequests ?? DEFAULT_MAX_CONTINUATION_REQUESTS;
  const fallbackModels = options?.fallbackModels ?? [];
  const maxRetries = options?.maxRetries ?? 2;
  const retryDelayMs = options?.retryDelayMs ?? 1200;

  const context = chunks && chunks.length > 0
    ? assembleContext(chunks, sources)
    : buildContext(sources);

  if (!context) {
    yield { type: "text", data: "No content available from sources to answer the query." };
    yield { type: "usage", data: NO_TOKENS };
    return;
  }

  const recencyLine =
    options?.preferLatest && options.currentDateTime
      ? `Current DateTime: ${options.currentDateTime}\nPrioritize the latest available developments and state uncertainties when dates conflict.\n\n`
      : "";
  const baseUserPrompt = `${recencyLine}## Web Sources\n\n${context}\n\n---\n\n## Question\n${query}`;
  let accumulatedText = "";
  let totalTokenUsage: TokenUsage = { ...NO_TOKENS };
  let continuationCount = 0;
  let shouldContinue = true;
  const models = Array.from(new Set([model, ...fallbackModels].filter((m) => m && m.trim().length > 0)));

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getErrorStatus(err: unknown): number | undefined {
    return typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: number }).status)
      : undefined;
  }

  function getErrorMessage(err: unknown): string {
    if (typeof err === "object" && err !== null) {
      const e = err as { error?: { message?: string; metadata?: { raw?: string } }; message?: string };
      return e.error?.metadata?.raw ?? e.error?.message ?? e.message ?? "LLM request failed.";
    }
    return "LLM request failed.";
  }

  function isRetryableStatus(status?: number): boolean {
    return status === 429 || status === 408 || status === 409 || (typeof status === "number" && status >= 500);
  }

  while (shouldContinue) {
    const messages =
      accumulatedText.length === 0
        ? [
            { role: "system" as const, content: SYSTEM_PROMPT },
            { role: "user" as const, content: baseUserPrompt },
          ]
        : [
            { role: "system" as const, content: SYSTEM_PROMPT },
            { role: "user" as const, content: baseUserPrompt },
            { role: "assistant" as const, content: accumulatedText },
            { role: "user" as const, content: CONTINUE_PROMPT },
          ];

    let stream: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;
    let lastError: unknown;

    modelLoop:
    for (const candidateModel of models) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          stream = await client.chat.completions.create({
            model: candidateModel,
            stream: true,
            stream_options: { include_usage: true },
            messages,
            temperature: 0.5,
            max_tokens: maxOutputTokens,
          });
          break modelLoop;
        } catch (err) {
          lastError = err;
          const status = getErrorStatus(err);
          const canRetry = isRetryableStatus(status) && attempt < maxRetries;
          if (canRetry) {
            await sleep(retryDelayMs * (attempt + 1));
            continue;
          }
          break;
        }
      }
    }

    if (!stream) {
      const status = getErrorStatus(lastError);
      const rawMessage = getErrorMessage(lastError);
      const helpText =
        status === 429
          ? "Rate-limited by model provider. Retry shortly, use paid/BYOK key, or configure fallbackChatModels."
          : status === 404
            ? "Model/policy routing failed. Check OpenRouter privacy settings and selected model availability."
            : "Model request failed after retries and fallbacks.";
      yield { type: "text", data: `${helpText}\nDetails: ${rawMessage}` };
      yield { type: "usage", data: totalTokenUsage };
      return;
    }

    let requestTokenUsage: TokenUsage = { ...NO_TOKENS };
    let hitLengthLimit = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        accumulatedText += delta;
        yield { type: "text", data: delta };
      }

      if (chunk.choices.some((choice) => choice.finish_reason === "length")) {
        hitLengthLimit = true;
      }

      if (chunk.usage) {
        requestTokenUsage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        };
      }
    }

    totalTokenUsage = addTokens(totalTokenUsage, requestTokenUsage);

    if (hitLengthLimit && continuationCount < maxContinuationRequests) {
      continuationCount += 1;
      continue;
    }

    shouldContinue = false;
  }

  yield { type: "usage", data: totalTokenUsage };
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
