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
      engineProvider: {
        provider: "brave",
      },
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
      stream: true,
    },
  });

  const query = process.argv.slice(2).join(" ") || "Give me todays top news on AI";
  console.log("\n=== User Query ===\n" + query);

  let finalSources: Array<{ title: string; url: string }> = [];
  let primaryProviderUsed = "";
  let providersUsed: string[] = [];
  let expandedQueriesPrinted = false;

  for await (const event of client.chat(query, {
    stream: true,
    citationStrictness: false,
  })) {
    const e = event as ChatEvent;

    if (e.type === "expanded_queries") {
      console.log("\n=== Expanded Queries [] ===");
      if (e.data.length === 0) {
        console.log("[]");
      } else {
        e.data.forEach((q, i) => {
          console.log(`${i + 1}. ${q}`);
        });
      }
      console.log("\n=== Answer (Stream) ===\n");
      expandedQueriesPrinted = true;
    }

    if (e.type === "text") {
      if (!expandedQueriesPrinted) {
        console.log("\n=== Expanded Queries [] ===");
        console.log("[]");
        console.log("\n=== Answer (Stream) ===\n");
        expandedQueriesPrinted = true;
      }
      process.stdout.write(e.data);
    }

    if (e.type === "sources") {
      finalSources = e.data.sources.map((s) => ({ title: s.title, url: s.url }));
      primaryProviderUsed = e.data.metadata.primaryProviderUsed ?? "";
      providersUsed = e.data.metadata.providersUsed ?? [];
    }

    if (e.type === "done") {
      process.stdout.write("\n");
    }
  }

  console.log("\n=== Sources ===");
  finalSources.forEach((source, index) => {
    console.log(`${index + 1}. ${source.title} - ${source.url}`);
  });
  console.log("\n=== Provider Used ===");
  if (providersUsed.length === 0) {
    console.log("No provider reported (no web hits).");
  } else {
    console.log(`Primary: ${primaryProviderUsed || providersUsed[0]}`);
    console.log(`All: ${providersUsed.join(", ")}`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Stream example failed:", message);
  process.exit(1);
});
