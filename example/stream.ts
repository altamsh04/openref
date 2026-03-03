import { OpenRef } from "../src";
import type { ChatEvent } from "../src";

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
      preferLatest: false,
      maxSources: 4,
      enableReranking: true,
      searchTimeout: 8000,
    },
    retrieval: {
      contentTimeout: 10000,
      maxContextTokens: 5000,
      chunkTargetTokens: 400,
    },
    response: {
      stream: true,
    },
  });

  const query = process.argv.slice(2).join(" ") || "What is OpenRouter?";
  console.log("\n=== Query ===\n" + query);
  console.log("\n=== Answer (Stream) ===\n");

  let finalSources: Array<{ title: string; url: string }> = [];

  for await (const event of client.chat(query, {
    stream: true,
    citationStrictness: false,
  })) {
    const e = event as ChatEvent;

    if (e.type === "text") {
      process.stdout.write(e.data);
    }

    if (e.type === "sources") {
      finalSources = e.data.sources.map((s) => ({ title: s.title, url: s.url }));
    }

    if (e.type === "done") {
      process.stdout.write("\n");
    }
  }

  console.log("\n=== Sources ===");
  finalSources.forEach((source, index) => {
    console.log(`${index + 1}. ${source.title} - ${source.url}`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Stream example failed:", message);
  process.exit(1);
});
