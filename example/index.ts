import { writeFileSync } from "node:fs";
import { OpenRef } from "openref";
import type { SearchResult, CitationMap } from "openref";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error("Set OPENROUTER_API_KEY environment variable");
  process.exit(1);
}

const mode = process.argv[2] ?? "chat";
const query = process.argv[3] ?? "Indian stock market trends February 2026";

const agent = new OpenRef({
  openRouterApiKey: OPENROUTER_API_KEY,
  model: "stepfun/step-3.5-flash:free",
  chatModel: "stepfun/step-3.5-flash:free",
  maxSources: 3,
  searchTimeout: 5000,
  fetchContent: true,
  contentTimeout: 6000,
  chat: true,
  enableReranking: true,
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
});

async function runSearch() {
  console.log(`\n[Search Mode] Query: "${query}"\n`);
  const result = await agent.search(query);
  console.log(`Intent: ${result.intent}`);
  console.log(`Found ${result.sources.length} sources (${result.metadata.latencyMs}ms)\n`);

  for (const source of result.sources) {
    const score = source.relevanceScore ? ` (score: ${source.relevanceScore.toFixed(2)})` : "";
    console.log(`  - ${source.title}${score}`);
    console.log(`    ${source.url}`);
  }

  writeFileSync("result.json", JSON.stringify(result, null, 2));
  console.log("\nSaved to result.json");
}

async function runChat() {
  console.log(`\n[Chat Mode] Query: "${query}"\n`);

  let searchResult: Record<string, unknown> | null = null;
  let citationMap: CitationMap = {};

  for await (const event of agent.chat(query)) {
    if (event.type === "sources") {
      searchResult = event.data as unknown as Record<string, unknown>;
      const data = event.data as SearchResult;
      console.log(`Intent: ${data.intent}`);
      console.log(`Found ${data.sources.length} sources (${data.metadata.latencyMs}ms)\n`);
      console.log("---\n");
    } else if (event.type === "text") {
      process.stdout.write(event.data);
    } else if (event.type === "citations") {
      citationMap = event.data;
    } else if (event.type === "done") {
      const { chatTokenUsage } = event.data;
      const output = {
        ...searchResult,
        chatTokenUsage,
        citationMap,
      };
      writeFileSync("result.json", JSON.stringify(output, null, 2));
      console.log("\n\n---");
      console.log("\nCitations:");
      for (const [num, cite] of Object.entries(citationMap)) {
        console.log(`  [${num}] ${cite.title} — ${cite.url}`);
      }
      console.log("\nSaved to result.json");
    }
  }
}

async function runDeepResearch() {
  console.log(`\n[Deep Research Mode] Query: "${query}"\n`);

  let citationMap: CitationMap = {};

  for await (const event of agent.deepResearch(query)) {
    if (event.type === "iteration") {
      console.log(`Pass ${event.data.pass + 1}/${event.data.totalPasses}: ${event.data.status}`);
    } else if (event.type === "sources") {
      console.log(`Found ${event.data.sources.length} sources (${event.data.metadata.latencyMs}ms)\n`);
    } else if (event.type === "text") {
      process.stdout.write(event.data);
    } else if (event.type === "done") {
      citationMap = event.data.citationMap;
      const output = {
        chatTokenUsage: event.data.chatTokenUsage,
        citationMap,
        iterations: event.data.iterations,
      };
      writeFileSync("result.json", JSON.stringify(output, null, 2));
      console.log("\n\n---");
      console.log(`\nCompleted in ${event.data.iterations} iterations`);
      console.log("\nCitations:");
      for (const [num, cite] of Object.entries(citationMap)) {
        console.log(`  [${num}] ${cite.title} — ${cite.url}`);
      }
      console.log("\nSaved to result.json");
    }
  }
}

if (mode === "search") {
  runSearch();
} else if (mode === "deep") {
  runDeepResearch();
} else {
  runChat();
}
