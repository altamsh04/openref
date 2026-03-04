import { getClient } from "./llmclient";

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

function sanitizeQueryLine(raw: string): string {
  return raw
    .trim()
    // Remove markdown/list prefixes
    .replace(/^[-*\d.)\s]+/, "")
    // Remove leading/trailing JSON-ish wrappers and quotes
    .replace(/^[\s\["'`]+/, "")
    .replace(/[\s\]"'`,]+$/, "")
    .trim();
}

function uniqQueries(list: string[], originalQuery: string, limit: number): string[] {
  const originalNorm = normalizeQuery(originalQuery);
  const seen = new Set<string>([originalNorm]);
  const out: string[] = [];

  for (const raw of list) {
    const cleaned = sanitizeQueryLine(raw);
    if (cleaned.length < 5 || cleaned.length > 140) continue;
    const norm = normalizeQuery(cleaned);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(cleaned);
    if (out.length >= limit) break;
  }

  return out;
}

function parseExpansionOutput(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(withoutFences);
    if (Array.isArray(parsed)) {
      return parsed.filter((q): q is string => typeof q === "string");
    }
  } catch {
    // fall through
  }

  return withoutFences
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function expandQuery(
  query: string,
  apiKey: string,
  model: string,
  count: number,
  timeoutMs: number,
  preferLatest: boolean,
  currentDateTime?: string
): Promise<string[]> {
  if (count <= 0) return [];

  const client = getClient(apiKey);
  const promptLines = [
    currentDateTime ? `Current DateTime: ${currentDateTime}` : "",
    `Original query: "${query}"`,
    `Generate up to ${count} distinct subqueries.`,
    preferLatest
      ? "Prioritize recency-oriented search phrasing for news/current events."
      : "Do not force recency unless the original query asks for it.",
  ].filter(Boolean);

  try {
    const primary = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 220,
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
      messages: [
        {
          role: "system",
          content:
            "Generate concise web-search subqueries that improve retrieval coverage. Return ONLY a JSON array of strings.",
        },
        {
          role: "user",
          content: `${promptLines.join("\n")}\nReturn format example: [\"subquery 1\", \"subquery 2\"]`,
        },
      ],
    });

    const primaryContent = primary.choices[0]?.message?.content ?? "";
    const primaryExpanded = uniqQueries(parseExpansionOutput(primaryContent), query, count);
    if (primaryExpanded.length > 0) return primaryExpanded;

    // Model-only fallback: relax output contract if strict JSON response was empty/malformed.
    const secondary = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 220,
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
      messages: [
        {
          role: "system",
          content:
            "Generate concise search rewrites. Return one subquery per line with no numbering and no extra text.",
        },
        {
          role: "user",
          content: `${promptLines.join("\n")}\nOutput only subqueries, one per line.`,
        },
      ],
    });

    const secondaryContent = secondary.choices[0]?.message?.content ?? "";
    return uniqQueries(parseExpansionOutput(secondaryContent), query, count);
  } catch {
    return [];
  }
}
