import { OpenRef } from "openref";

const agent = new OpenRef({
  openRouterApiKey: "sk-or-v1......",
  chatModel: "stepfun/step-3.5-flash:free",
  maxSources: 3,
  searchTimeout: 5000,
  contentTimeout: 6000,
  enableReranking: true,
  maxContextTokens: 6000,
  chunkTargetTokens: 400,
});


const query = "recent wars between iran and israel";

async function runChat() {
  const response = await agent.chat(query, { stream: false });
  console.log(JSON.stringify(response, null, 2));
}

runChat();
