import type { Source } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (compatible; OpenRef/1.0; +https://github.com/openref)";

interface MarkdownResult {
  markdown: string;
  tokens: number;
}

async function fetchMarkdownNative(
  url: string,
  timeout: number
): Promise<MarkdownResult | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/markdown, text/html;q=0.9",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/markdown")) return null;

    const markdown = await res.text();
    const tokens = parseInt(res.headers.get("x-markdown-tokens") ?? "0", 10);

    return { markdown, tokens };
  } catch {
    return null;
  }
}

async function fetchMarkdownViaProxy(
  url: string,
  timeout: number
): Promise<MarkdownResult | null> {
  try {
    const res = await fetch(`https://markdown.new/${url}`, {
      headers: {
        Accept: "text/markdown",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) return null;

    const markdown = await res.text();
    const tokens = parseInt(res.headers.get("x-markdown-tokens") ?? "0", 10);

    return { markdown, tokens };
  } catch {
    return null;
  }
}

async function fetchMarkdown(
  url: string,
  timeout: number
): Promise<MarkdownResult | null> {
  // Tier 1: try native text/markdown from the source
  const native = await fetchMarkdownNative(url, timeout);
  if (native) return native;

  // Tier 2: fallback to markdown.new proxy
  return fetchMarkdownViaProxy(url, timeout);
}

export async function enrichWithMarkdown(
  sources: Source[],
  timeout: number
): Promise<Source[]> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const result = await fetchMarkdown(source.url, timeout);
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
