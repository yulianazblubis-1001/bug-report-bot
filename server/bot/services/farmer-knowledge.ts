import { getAllChunks, type KbChunk } from '../farmer-kb-db';
import { embedTexts, cosineSimilarity } from './voyage';

const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: KbChunk[] | null = null;
let cacheLoadedAt = 0;

async function loadCache(): Promise<KbChunk[]> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  cache = await getAllChunks();
  cacheLoadedAt = now;
  console.log(`[FarmerKnowledge] Loaded ${cache.length} chunks into cache`);
  return cache;
}

/** Call after a resync so the next question picks up fresh data immediately instead of waiting out the TTL. */
export function invalidateCache(): void {
  cache = null;
}

export interface RelevantChunk {
  text: string;
  source: string;
}

/**
 * Hybrid retrieval: location names (kecamatan/kabupaten/provinsi) get an
 * exact-match boost before semantic search runs. Sub-district names can be
 * textually close but agronomically distinct (e.g. two different Cikarangs),
 * so a fertilizer-dosage lookup for a named location must not be left to
 * vector similarity alone — it's prioritized deterministically, then
 * semantic search fills in the rest for open-ended questions.
 */
export async function findRelevantContext(question: string, topK = 6): Promise<RelevantChunk[]> {
  const chunks = await loadCache();
  if (chunks.length === 0) return [];

  const lowerQ = question.toLowerCase();
  const locationMatches = chunks.filter((c) => {
    const meta = c.metadata || {};
    return Object.values(meta).some(
      (v) => typeof v === 'string' && v.length > 2 && lowerQ.includes(v.toLowerCase())
    );
  });

  let semanticTop: KbChunk[] = [];
  try {
    const [qEmbedding] = await embedTexts([question], 'query');
    const scored = chunks.map((c) => ({ c, score: cosineSimilarity(qEmbedding, c.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    semanticTop = scored.slice(0, topK).map((s) => s.c);
  } catch (err: any) {
    console.error('[FarmerKnowledge] Semantic search failed, falling back to location matches only:', err.message);
  }

  const combined = [...locationMatches.slice(0, 4), ...semanticTop];
  const seen = new Set<number>();
  const result: RelevantChunk[] = [];
  for (const c of combined) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    result.push({ text: c.chunkText, source: c.source });
    if (result.length >= topK + 4) break;
  }
  return result;
}
