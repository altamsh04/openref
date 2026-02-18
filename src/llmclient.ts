import OpenAI from "openai";

let clientCache: { key: string; client: OpenAI } | null = null;

export function getClient(apiKey: string): OpenAI {
  if (clientCache?.key === apiKey) return clientCache.client;
  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  clientCache = { key: apiKey, client };
  return client;
}
