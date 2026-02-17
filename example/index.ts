import { writeFileSync } from "node:fs";
import { OpenRef } from "openref";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error("Set OPENROUTER_API_KEY environment variable");
  process.exit(1);
}

const agent = new OpenRef({
  openRouterApiKey: OPENROUTER_API_KEY,
  model: "stepfun/step-3.5-flash:free",
  chatModel: "stepfun/step-3.5-flash:free",
  maxSources: 3,
  searchTimeout: 5000,
  expandQuery: true,
  fetchContent: true,
  contentTimeout: 8000,
  chat: true,
});

const query = "bitcoin price today";

console.log(`\nQuery: "${query}"\n`);

let searchResult: Record<string, unknown> | null = null;

for await (const event of agent.chat(query)) {
  if (event.type === "sources") {
    searchResult = event.data as unknown as Record<string, unknown>;
    console.log(`Found ${event.data.sources.length} sources (${event.data.metadata.latencyMs}ms)\n`);
    console.log("---\n");
  } else if (event.type === "text") {
    process.stdout.write(event.data);
  } else if (event.type === "done") {
    const { chatTokenUsage } = event.data;
    const output = {
      ...searchResult,
      chatTokenUsage,
    };
    writeFileSync("result.json", JSON.stringify(output, null, 2));
    console.log("\n\n---");
    console.log("Saved to result.json");
  }
}
