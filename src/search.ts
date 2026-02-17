import * as cheerio from "cheerio";
import type { RawSearchHit } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "en-US,en;q=0.9",
};

function parseBraveHTML(html: string): RawSearchHit[] {
  const $ = cheerio.load(html);
  $("style, script, noscript, svg").remove();

  const hits: RawSearchHit[] = [];
  const seen = new Set<string>();

  $(".snippet").each((_, el) => {
    const anchor = $(el).find("a[href]").first();
    const href = anchor.attr("href") ?? "";

    if (!href.startsWith("http") || href.includes("brave.com")) return;
    if (seen.has(href)) return;
    seen.add(href);

    const title = $(el).find(".search-snippet-title").first().text().trim();

    if (title.length > 3) {
      hits.push({ url: href, title });
    }
  });

  return hits;
}

export async function searchWeb(
  query: string,
  timeout: number
): Promise<RawSearchHit[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) return [];
    return parseBraveHTML(await res.text());
  } catch {
    return [];
  }
}

export async function searchAll(
  queries: string[],
  timeout: number
): Promise<RawSearchHit[]> {
  const results = await Promise.allSettled(
    queries.map((q) => searchWeb(q, timeout))
  );

  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
