#!/usr/bin/env node

const { OpenRef } = require("../dist/index.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runConfigOnlyChecks() {
  const client = new OpenRef({
    llm: { apiKey: "test-key" },
  });

  assert(typeof client.search === "function", "OpenRef.search should exist");
  assert(typeof client.chat === "function", "OpenRef.chat should exist");

  const groupedClient = new OpenRef({
    llm: {
      apiKey: "test-key",
      chatModel: "nvidia/nemotron-3-nano-30b-a3b:free",
      systemPrompt: "Use concise answers.",
      citationStrictness: true,
    },
    search: {
      maxSources: 3,
      preferLatest: true,
      enableReranking: true,
    },
    retrieval: {
      maxContextTokens: 2000,
      chunkTargetTokens: 300,
    },
    response: {
      stream: true,
    },
  });

  assert(typeof groupedClient.search === "function", "Grouped config OpenRef.search should exist");
  assert(typeof groupedClient.chat === "function", "Grouped config OpenRef.chat should exist");

  const legacyClient = new OpenRef({
    openRouterApiKey: "test-key",
    chatModel: "nvidia/nemotron-3-nano-30b-a3b:free",
    maxSources: 3,
  });

  assert(typeof legacyClient.search === "function", "Legacy config OpenRef.search should exist");
  assert(typeof legacyClient.chat === "function", "Legacy config OpenRef.chat should exist");
}

async function runLiveChecks(apiKey) {
  const client = new OpenRef({
    llm: {
      apiKey,
      citationStrictness: true,
      maxRetries: 1,
      maxOutputTokens: 256,
      maxContinuationRequests: 1,
    },
    search: {
      maxSources: 3,
      searchTimeout: 6000,
      enableReranking: false,
    },
    retrieval: {
      contentTimeout: 6000,
      maxContextTokens: 2000,
      chunkTargetTokens: 250,
    },
    response: {
      stream: true,
    },
  });

  const query = "Today's top news in AI";

  const searchResult = await client.search(query);
  assert(Array.isArray(searchResult.sources), "search() should return sources array");

  const nonStream = await client.chat(query, {
    stream: false,
    citationStrictness: false,
  });
  assert(typeof nonStream.text === "string", "chat(stream:false) should return text");
  assert(nonStream.citationMap && typeof nonStream.citationMap === "object", "chat(stream:false) should return citationMap");

  const stream = client.chat(query, {
    stream: true,
    citationStrictness: true,
  });

  let seenDone = false;
  for await (const event of stream) {
    if (event.type === "done") seenDone = true;
  }
  assert(seenDone, "chat(stream:true) should emit done event");
}

async function main() {
  await runConfigOnlyChecks();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("[smoke] Config/API surface checks passed.");
    console.log("[smoke] Skipping live network checks (set OPENROUTER_API_KEY to enable).\n");
    return;
  }

  await runLiveChecks(apiKey);
  console.log("[smoke] Config/API checks passed.");
  console.log("[smoke] Live search/chat checks passed.\n");
}

main().catch((err) => {
  console.error("[smoke] Failed:", err?.message || err);
  process.exit(1);
});
