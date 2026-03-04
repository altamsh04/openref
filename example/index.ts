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
      systemPrompt: "Be Content in proper markdown format.",
    },
    search: {
      engineProvider: { provider: "brave" },
      preferLatest: false,
      maxSources: 3,
      enableReranking: true,
      searchTimeout: 8000,
    },
    retrieval: {
      contentTimeout: 10000,
      maxContextTokens: 5000,
      chunkTargetTokens: 500,
    },
    response: {
      stream: true,
    },
  });

  const query = process.argv.slice(2).join(" ") || "Today's top news in AI";
  const response = await client.chat(query, {
    stream: false as const,
    citationStrictness: false,
  });

  console.log("\n=== Query ===\n" + query);
  console.log("\n=== Answer ===\n" + response.text);
  console.log("\n=== Sources ===");
  response.sources.forEach((source: { title: string; url: string }, index: number) => {
    console.log(`${index + 1}. ${source.title} - ${source.url}`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Example failed:", message);
  process.exit(1);
});
