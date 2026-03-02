import { OpenRef } from "openref";

const OPENROUTER_API_KEY = "sk-or-v1......";

const agent = new OpenRef({
  openRouterApiKey: OPENROUTER_API_KEY,
  preferLatest: true,
  timeZone: "UTC",
  chatModel: "nvidia/nemotron-3-nano-30b-a3b:free",
  // fallbackChatModels: [
  //   "google/gemma-2-9b-it:free",
  //   "mistralai/mistral-small-3.1-24b-instruct:free",
  // ],
  // maxRetries: 2,
  // retryDelayMs: 1200,
  maxSources: 3,
  searchTimeout: 5000,
  contentTimeout: 6000,
  enableReranking: true,
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
});
const query = "today's hot news";

async function runChat() {
  const response = await agent.chat(query, { stream: false });
  console.log(JSON.stringify(response, null, 2));
}

runChat();
