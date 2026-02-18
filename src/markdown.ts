import * as cheerio from "cheerio";
import type { Source, ScoredChunk } from "./types";
import { chunkMarkdown, scoreChunks, selectTopChunks } from "./chunker";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface MarkdownResult {
  markdown: string;
  tokens: number;
}

/**
 * Tokenize a query string into key terms for relevance matching.
 */
function extractQueryTerms(query: string, expandedQueries: string[] = []): string[] {
  const allText = [query, ...expandedQueries].join(" ");
  const terms = allText
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return [...new Set(terms)];
}

/**
 * Extract only query-relevant sections from HTML instead of the full page text.
 * Splits HTML into section-level blocks and keeps only those with query term overlap.
 */
function extractRelevantSections(html: string, queryTerms: string[]): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $(
    "script, style, noscript, svg, nav, footer, header, aside, " +
    "iframe, form, button, input, select, textarea, " +
    "[role='navigation'], [role='banner'], [role='complementary'], " +
    ".nav, .navbar, .footer, .sidebar, .menu, .ad, .ads, .advertisement, " +
    ".cookie, .popup, .modal, .share, .social, .comments"
  ).remove();

  // Find the main content container
  const mainEl =
    $("article").first().length ? $("article").first() :
    $("main").first().length ? $("main").first() :
    $("[role='main']").first().length ? $("[role='main']").first() :
    $(".content, .post, .article, .entry-content, .post-content").first().length
      ? $(".content, .post, .article, .entry-content, .post-content").first()
      : $("body");

  // Split into section-level blocks
  const blocks: { text: string; relevant: boolean }[] = [];
  const blockSelectors = "h1, h2, h3, h4, h5, h6, p, div, li, tr, blockquote, pre, section";

  // Collect leaf-level text blocks
  mainEl.find(blockSelectors).each((_, el) => {
    const $el = $(el);
    // Skip elements that contain other block elements (avoid duplication)
    if ($el.find(blockSelectors).length > 0 && el.tagName !== "li" && el.tagName !== "tr") return;

    const text = $el.text().trim();
    if (text.length < 10) return;

    const textLower = text.toLowerCase();
    const relevant = queryTerms.some((term) => textLower.includes(term));
    blocks.push({ text, relevant });
  });

  // If very few blocks found, fall back to full text extraction
  if (blocks.length < 3) {
    return fallbackExtract($, mainEl);
  }

  // Keep relevant blocks + surrounding context (1 block before/after)
  const kept = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].relevant) {
      if (i > 0) kept.add(i - 1);
      kept.add(i);
      if (i < blocks.length - 1) kept.add(i + 1);
    }
  }

  // If no blocks matched, keep top portion as fallback
  if (kept.size === 0) {
    return fallbackExtract($, mainEl);
  }

  const result = Array.from(kept)
    .sort((a, b) => a - b)
    .map((i) => blocks[i].text)
    .join("\n\n");

  // Cap at ~500 tokens (2000 chars)
  return result.length > 2000 ? result.slice(0, 2000) : result;
}

function fallbackExtract($: cheerio.CheerioAPI, mainEl: cheerio.Cheerio<any>): string {
  let text = mainEl.text().trim();
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/\n /g, "\n")
    .trim();
  if (text.length > 2000) text = text.slice(0, 2000);
  return text;
}

/**
 * Fetch a page and extract only query-relevant text content.
 */
async function fetchMarkdown(
  url: string,
  timeout: number,
  queryTerms: string[],
  signal?: AbortSignal
): Promise<MarkdownResult | null> {
  try {
    // Combine timeout and external abort signal
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
        },
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) return null;

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        return null;
      }

      const html = await res.text();
      const markdown = queryTerms.length > 0
        ? extractRelevantSections(html, queryTerms)
        : htmlToText(html);

      if (markdown.length < 50) return null;

      const tokens = Math.ceil(markdown.length / 4);
      return { markdown, tokens };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Convert HTML to readable plain text / lightweight markdown using cheerio.
 * Used as fallback when no query terms are provided.
 */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, svg, nav, footer, header, aside, " +
    "iframe, form, button, input, select, textarea, " +
    "[role='navigation'], [role='banner'], [role='complementary'], " +
    ".nav, .navbar, .footer, .sidebar, .menu, .ad, .ads, .advertisement, " +
    ".cookie, .popup, .modal, .share, .social, .comments"
  ).remove();

  const mainContent =
    $("article").text().trim() ||
    $("main").text().trim() ||
    $("[role='main']").text().trim() ||
    $(".content, .post, .article, .entry-content, .post-content").first().text().trim();

  let text: string;

  if (mainContent && mainContent.length > 100) {
    text = mainContent;
  } else {
    text = $("body").text().trim();
  }

  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/\n /g, "\n")
    .trim();

  if (text.length > 2000) {
    text = text.slice(0, 2000);
  }

  return text;
}

export async function enrichWithMarkdown(
  sources: Source[],
  timeout: number
): Promise<Source[]> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const result = await fetchMarkdown(source.url, timeout, []);
      if (result) {
        return {
          ...source,
          markdown: result.markdown,
          markdownTokens: result.tokens,
        };
      }
      return source;
    })
  );

  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : sources[i]
  );
}

/**
 * Parallel per-source pipeline: fetch → query-aware extract → chunk → score.
 * Includes early termination once we have enough good chunks.
 */
export async function fetchAndChunk(
  sources: Source[],
  query: string,
  expandedQueries: string[],
  timeout: number,
  maxContextTokens: number = 6000,
  chunkTargetTokens: number = 400
): Promise<{ chunks: ScoredChunk[]; enrichedSources: Source[] }> {
  const queryTerms = extractQueryTerms(query, expandedQueries);
  const earlyAbort = new AbortController();
  let collectedTokens = 0;

  // Process each source independently and concurrently
  const perSourceResults = await Promise.allSettled(
    sources.map(async (source, sourceIndex) => {
      // Check if we should skip (early termination)
      if (earlyAbort.signal.aborted) {
        return { source, chunks: [] as ScoredChunk[], sourceIndex };
      }

      let markdown: string;
      let enrichedSource: Source;

      // Reuse existing markdown if source was already fetched (e.g. via enrichWithMarkdown)
      if (source.markdown) {
        markdown = source.markdown;
        enrichedSource = source;
      } else {
        const result = await fetchMarkdown(source.url, timeout, queryTerms, earlyAbort.signal);

        if (!result) {
          return { source, chunks: [] as ScoredChunk[], sourceIndex };
        }

        markdown = result.markdown;
        enrichedSource = {
          ...source,
          markdown: result.markdown,
          markdownTokens: result.tokens,
        };
      }

      // Chunk and score immediately for this source
      const rawChunks = chunkMarkdown(markdown, chunkTargetTokens).map((chunk) => ({
        ...chunk,
        sourceIndex,
      }));

      const scored = scoreChunks(rawChunks, query, expandedQueries);

      // Track cumulative tokens from top chunks
      const topFromSource = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, 3); // best 3 chunks per source
      const sourceTokens = topFromSource.reduce((sum, c) => sum + c.tokenEstimate, 0);
      collectedTokens += sourceTokens;

      // If we've collected enough, signal other sources to abort
      if (collectedTokens >= maxContextTokens * 1.5) {
        earlyAbort.abort();
      }

      return { source: enrichedSource, chunks: scored, sourceIndex };
    })
  );

  // Collect results
  const enrichedSources: Source[] = sources.map((s) => s);
  const allChunks: ScoredChunk[] = [];

  for (const result of perSourceResults) {
    if (result.status === "fulfilled") {
      const { source, chunks, sourceIndex } = result.value;
      enrichedSources[sourceIndex] = source;
      allChunks.push(...chunks);
    }
  }

  if (allChunks.length === 0) {
    return { chunks: [], enrichedSources };
  }

  const selected = selectTopChunks(allChunks, maxContextTokens);

  return { chunks: selected, enrichedSources };
}
