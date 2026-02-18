import type { RawSearchHit, Source } from "./types";
import { getClient } from "./llmclient";

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function rankAndDedup(
  hits: RawSearchHit[],
  maxSources: number
): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];

  for (const hit of hits) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);

    sources.push({
      url: hit.url,
      title: hit.title,
      domain: extractDomain(hit.url),
    });
  }

  // promote domain diversity: avoid stacking results from one domain
  const domainCount = new Map<string, number>();
  sources.sort((a, b) => {
    const countA = domainCount.get(a.domain) ?? 0;
    const countB = domainCount.get(b.domain) ?? 0;
    domainCount.set(a.domain, countA + 1);
    domainCount.set(b.domain, countB + 1);
    return countA - countB;
  });

  return sources.slice(0, maxSources);
}

/** Phase 3: fast filter keeps top candidates using existing dedup + diversity */
export function fastFilter(
  hits: RawSearchHit[],
  maxCandidates: number = 30
): Source[] {
  return rankAndDedup(hits, maxCandidates);
}

/** Phase 3: LLM re-ranking — sends titles + snippets, gets relevance-ordered IDs */
export async function llmRerank(
  query: string,
  candidates: Source[],
  snippets: Map<string, string>,
  apiKey: string,
  model: string,
  maxSources: number,
  timeout: number = 4000
): Promise<Source[]> {
  if (candidates.length <= maxSources) return candidates;

  const client = getClient(apiKey);

  const candidateList = candidates
    .map((s, i) => {
      const snippet = snippets.get(s.url) ?? "";
      const snippetText = snippet ? ` — ${snippet.slice(0, 120)}` : "";
      return `[${i}] ${s.title}${snippetText}`;
    })
    .join("\n");

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a search result ranker. Given a query and a numbered list of search results (with titles and snippets), return the IDs of the most relevant results in order of relevance. Output ONLY a JSON array of numbers, e.g. [3, 0, 7, 1]. Select the top ${maxSources} most relevant results.`,
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nResults:\n${candidateList}`,
        },
      ],
      temperature: 0,
      max_tokens: 150,
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "[]";

    let ids: number[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        ids = parsed.filter((id): id is number => typeof id === "number" && id >= 0 && id < candidates.length);
      }
    } catch {
      const matches = content.match(/\d+/g);
      if (matches) {
        ids = matches
          .map(Number)
          .filter((id) => id >= 0 && id < candidates.length);
      }
    }

    if (ids.length === 0) return candidates.slice(0, maxSources);

    const seen = new Set<number>();
    const reranked: Source[] = [];

    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      reranked.push({ ...candidates[id], relevanceScore: 1 - reranked.length / ids.length });
      if (reranked.length >= maxSources) break;
    }

    // Fill remaining slots if LLM returned fewer than maxSources
    if (reranked.length < maxSources) {
      for (let i = 0; i < candidates.length && reranked.length < maxSources; i++) {
        if (!seen.has(i)) reranked.push(candidates[i]);
      }
    }

    return reranked;
  } catch {
    // Timeout or error: fall back to fast filter order
    return candidates.slice(0, maxSources);
  }
}
