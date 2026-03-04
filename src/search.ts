import * as cheerio from "cheerio";
import type { RawSearchHit, SearchProvider } from "./types";

export const ALL_SEARCH_PROVIDERS: SearchProvider[] = ["brave", "duckduckgo", "bing", "searxng", "searxncg"];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "en-US,en;q=0.9",
};

function parseBraveHTML(html: string, querySource?: string): RawSearchHit[] {
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
    const snippet =
      $(el).find(".generic-snippet .content").first().text().trim() ||
      $(el).find(".snippet-description").first().text().trim() ||
      "";

    if (title.length > 3) {
      hits.push({ url: href, title, snippet: snippet || undefined, querySource, provider: "brave" });
    }
  });

  return hits;
}

function parseDuckDuckGoHTML(html: string, querySource?: string): RawSearchHit[] {
  const $ = cheerio.load(html);
  $("style, script, noscript, svg").remove();

  const hits: RawSearchHit[] = [];
  const seen = new Set<string>();

  $(".result, .web-result, .results_links").each((_, el) => {
    const anchor = $(el).find("a.result__a, a.result__url, a[href]").first();
    let href = anchor.attr("href") ?? "";

    // DuckDuckGo sometimes wraps URLs in redirect links
    if (href.includes("duckduckgo.com/l/?uddg=")) {
      try {
        const parsed = new URL(href, "https://duckduckgo.com");
        href = decodeURIComponent(parsed.searchParams.get("uddg") ?? href);
      } catch { /* use href as-is */ }
    }

    if (!href.startsWith("http") || href.includes("duckduckgo.com")) return;
    if (seen.has(href)) return;
    seen.add(href);

    const title =
      $(el).find(".result__title, a.result__a").first().text().trim() ||
      anchor.text().trim();
    const snippet =
      $(el).find(".result__snippet").first().text().trim() || "";

    if (title.length > 3) {
      hits.push({ url: href, title, snippet: snippet || undefined, querySource, provider: "duckduckgo" });
    }
  });

  return hits;
}

function parseBingHTML(html: string, querySource?: string): RawSearchHit[] {
  const $ = cheerio.load(html);
  $("style, script, noscript, svg").remove();

  const hits: RawSearchHit[] = [];
  const seen = new Set<string>();

  $("li.b_algo").each((_, el) => {
    const anchor = $(el).find("h2 a[href], a[href]").first();
    const href = anchor.attr("href") ?? "";

    if (!href.startsWith("http")) return;
    if (href.includes("bing.com")) return;
    if (seen.has(href)) return;
    seen.add(href);

    const title = anchor.text().trim();
    const snippet =
      $(el).find(".b_caption p").first().text().trim() ||
      $(el).find("p").first().text().trim() ||
      "";

    if (title.length > 3) {
      hits.push({ url: href, title, snippet: snippet || undefined, querySource, provider: "bing" });
    }
  });

  return hits;
}

async function searchBrave(query: string, timeout: number): Promise<RawSearchHit[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) return [];
    return parseBraveHTML(await res.text(), query);
  } catch {
    return [];
  }
}

async function searchDuckDuckGo(query: string, timeout: number): Promise<RawSearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) return [];
    return parseDuckDuckGoHTML(await res.text(), query);
  } catch {
    return [];
  }
}

async function searchBing(query: string, timeout: number): Promise<RawSearchHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) return [];
    return parseBingHTML(await res.text(), query);
  } catch {
    return [];
  }
}

function buildQueryUrl(baseUrl: string, query: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.set("q", query);
    return parsed.toString();
  } catch {
    if (trimmed.includes("{query}")) {
      return trimmed.replaceAll("{query}", encodeURIComponent(query));
    }
    return `${trimmed}${trimmed.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`;
  }
}

function parseSearxngHTML(html: string, querySource?: string): RawSearchHit[] {
  const $ = cheerio.load(html);
  $("style, script, noscript, svg").remove();

  const hits: RawSearchHit[] = [];
  const seen = new Set<string>();

  $("article.result, .result, .results article").each((_, el) => {
    const anchor = $(el).find("h3 a[href], a.result_header[href], a[href]").first();
    const href = anchor.attr("href") ?? "";

    if (!href.startsWith("http")) return;
    if (seen.has(href)) return;
    seen.add(href);

    const title = anchor.text().trim();
    const snippet =
      $(el).find(".content").first().text().trim() ||
      $(el).find("p").first().text().trim() ||
      "";

    if (title.length > 3) {
      hits.push({ url: href, title, snippet: snippet || undefined, querySource, provider: "searxng" });
    }
  });

  return hits;
}

async function searchSearxng(query: string, timeout: number, queryUrl?: string): Promise<RawSearchHit[]> {
  const url = buildQueryUrl(queryUrl || "http://localhost:8080/search", query);

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) return [];

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const payload: any = await res.json().catch(() => null);
      const results = Array.isArray(payload?.results) ? payload.results : [];
      const seen = new Set<string>();
      const hits: RawSearchHit[] = [];
      for (const item of results) {
        const href = typeof item?.url === "string" ? item.url : "";
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        const snippet = typeof item?.content === "string" ? item.content.trim() : "";
        if (!href.startsWith("http") || !title || seen.has(href)) continue;
        seen.add(href);
        hits.push({ url: href, title, snippet: snippet || undefined, querySource: query, provider: "searxng" });
      }
      return hits;
    }

    return parseSearxngHTML(await res.text(), query);
  } catch {
    return [];
  }
}

/**
 * Search with ordered provider fallback.
 */
export async function searchWeb(
  query: string,
  timeout: number,
  providers: SearchProvider[] = ALL_SEARCH_PROVIDERS,
  providerQueryUrl?: string
): Promise<RawSearchHit[]> {
  const providerSet = providers.length > 0 ? providers : ALL_SEARCH_PROVIDERS;

  for (const provider of providerSet) {
    let hits: RawSearchHit[] = [];
    if (provider === "brave") {
      hits = await searchBrave(query, timeout);
    } else if (provider === "duckduckgo") {
      hits = await searchDuckDuckGo(query, timeout);
    } else if (provider === "searxng" || provider === "searxncg") {
      hits = await searchSearxng(query, timeout, providerQueryUrl);
    } else {
      hits = await searchBing(query, timeout);
    }

    if (hits.length > 0) return hits;
  }

  return [];
}

export async function searchAll(
  queries: string[],
  timeout: number,
  providers: SearchProvider[] = ALL_SEARCH_PROVIDERS,
  providerQueryUrl?: string
): Promise<RawSearchHit[]> {
  const results = await Promise.allSettled(
    queries.map((q) => searchWeb(q, timeout, providers, providerQueryUrl))
  );

  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
