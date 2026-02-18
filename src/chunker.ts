import type { Chunk, ScoredChunk } from "./types";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkMarkdown(markdown: string, targetTokens: number = 400): Chunk[] {
  const chunks: Chunk[] = [];

  // Split on paragraph boundaries (double newline)
  let paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim().length > 0);

  let currentChunk = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // If single paragraph exceeds target, split by sentences
    if (paraTokens > targetTokens * 1.5 && currentChunk === "") {
      const sentences = para.match(/[^.!?]+[.!?]+/g) ?? [para];
      let sentenceChunk = "";

      for (const sentence of sentences) {
        if (estimateTokens(sentenceChunk + sentence) > targetTokens && sentenceChunk) {
          chunks.push({
            content: sentenceChunk.trim(),
            tokenEstimate: estimateTokens(sentenceChunk),
            sourceIndex: -1, // filled by caller
            chunkIndex: chunkIndex++,
          });
          sentenceChunk = sentence;
        } else {
          sentenceChunk += sentence;
        }
      }
      if (sentenceChunk.trim()) {
        chunks.push({
          content: sentenceChunk.trim(),
          tokenEstimate: estimateTokens(sentenceChunk),
          sourceIndex: -1,
          chunkIndex: chunkIndex++,
        });
      }
      continue;
    }

    if (estimateTokens(currentChunk + "\n\n" + para) > targetTokens && currentChunk) {
      chunks.push({
        content: currentChunk.trim(),
        tokenEstimate: estimateTokens(currentChunk),
        sourceIndex: -1,
        chunkIndex: chunkIndex++,
      });
      currentChunk = para;
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      tokenEstimate: estimateTokens(currentChunk),
      sourceIndex: -1,
      chunkIndex: chunkIndex++,
    });
  }

  return chunks;
}

function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export function scoreChunks(
  chunks: Chunk[],
  query: string,
  expandedQueries: string[]
): ScoredChunk[] {
  const allQueries = [query, ...expandedQueries];
  const queryTerms = new Set<string>();

  for (const q of allQueries) {
    for (const term of tokenizeQuery(q)) {
      queryTerms.add(term);
    }
  }

  const termArray = Array.from(queryTerms);

  return chunks.map((chunk) => {
    const contentLower = chunk.content.toLowerCase();
    let score = 0;

    for (const term of termArray) {
      const regex = new RegExp(`\\b${term}`, "gi");
      const matches = contentLower.match(regex);
      if (matches) {
        // Weighted: more matches = higher score, with diminishing returns
        score += Math.log2(1 + matches.length);
      }
    }

    // Normalize by chunk size to avoid bias toward longer chunks
    const normalizedScore = chunk.tokenEstimate > 0 ? score / Math.sqrt(chunk.tokenEstimate) : 0;

    return { ...chunk, score: normalizedScore };
  });
}

export function selectTopChunks(
  scoredChunks: ScoredChunk[],
  maxTotalTokens: number = 6000
): ScoredChunk[] {
  if (scoredChunks.length === 0) return [];

  // Group by source
  const bySource = new Map<number, ScoredChunk[]>();
  for (const chunk of scoredChunks) {
    const list = bySource.get(chunk.sourceIndex) ?? [];
    list.push(chunk);
    bySource.set(chunk.sourceIndex, list);
  }

  // Sort each source's chunks by score descending
  for (const chunks of bySource.values()) {
    chunks.sort((a, b) => b.score - a.score);
  }

  const selected: ScoredChunk[] = [];
  let totalTokens = 0;

  // Round 1: ensure at least 1 chunk per source (best chunk from each)
  const sortedSources = Array.from(bySource.entries())
    .map(([idx, chunks]) => ({ idx, best: chunks[0] }))
    .sort((a, b) => b.best.score - a.best.score);

  for (const { best } of sortedSources) {
    if (totalTokens + best.tokenEstimate > maxTotalTokens) continue;
    selected.push(best);
    totalTokens += best.tokenEstimate;
  }

  // Round 2: greedily fill remaining budget with best remaining chunks
  const allSorted = scoredChunks
    .filter((c) => !selected.includes(c))
    .sort((a, b) => b.score - a.score);

  for (const chunk of allSorted) {
    if (totalTokens + chunk.tokenEstimate > maxTotalTokens) continue;
    selected.push(chunk);
    totalTokens += chunk.tokenEstimate;
  }

  // Sort final selection by source index then chunk index for coherent reading
  selected.sort((a, b) => a.sourceIndex - b.sourceIndex || a.chunkIndex - b.chunkIndex);

  return selected;
}
