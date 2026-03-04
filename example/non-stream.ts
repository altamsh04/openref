import { OpenRef } from "../src";

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Set OPENROUTER_API_KEY before running this example.");
  }

  const client = new OpenRef({
    llm: {
      apiKey,
      citationStrictness: false,
      systemPrompt: "Respond in concise markdown.",
    },
    search: {
      engineProvider: { provider: "duckduckgo" },
      preferLatest: false,
      maxSources: 4,
      queryExpansion: true,
      queryExpansionValue: 3,
      queryExpansionTimeout: 5000,
      enableReranking: true,
      searchTimeout: 8000,
    },
    retrieval: {
      contentTimeout: 10000,
      maxContextTokens: 5000,
      chunkTargetTokens: 400,
    },
    response: {
      stream: false,
    },
  });

  const query = process.argv.slice(2).join(" ") || "What is OpenRouter?";
  const response = await client.chat(query, {
    stream: false,
    citationStrictness: false,
  });

  console.log("\n=== User Query ===\n" + query);
  const expandedQueries = response.metadata.expandedQueries ?? [];
  console.log("\n=== Expanded Queries [] ===");
  if (expandedQueries.length === 0) {
    console.log("[]");
  } else {
    expandedQueries.forEach((q, i) => {
      console.log(`${i + 1}. ${q}`);
    });
  }
  console.log("\n=== Answer (Non-Stream) ===\n" + response.text);
  console.log("\n=== Sources ===");
  response.sources.forEach((source, index) => {
    console.log(`${index + 1}. ${source.title} - ${source.url}`);
  });
  const providersUsed = response.metadata.providersUsed ?? [];
  console.log("\n=== Provider Used ===");
  if (providersUsed.length === 0) {
    console.log("No provider reported (no web hits).");
  } else {
    console.log(`Primary: ${response.metadata.primaryProviderUsed ?? providersUsed[0]}`);
    console.log(`All: ${providersUsed.join(", ")}`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Non-stream example failed:", message);
  process.exit(1);
});
