import type { RawSearchHit, Source } from "./types";

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
