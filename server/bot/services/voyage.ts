const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const DEFAULT_MODEL = 'voyage-3.5-lite';
const BATCH_SIZE = 100;

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

/**
 * Embeds a batch of texts via Voyage AI (Anthropic's recommended embeddings
 * partner — Claude itself has no embeddings endpoint). `inputType` tells
 * Voyage whether these are corpus documents being indexed or a live query,
 * which it uses to optimize the embedding for retrieval.
 */
export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query'
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY not set');
  }
  if (texts.length === 0) return [];

  const model = process.env.VOYAGE_EMBED_MODEL || DEFAULT_MODEL;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: batch,
        model,
        input_type: inputType,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Voyage embeddings API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as VoyageEmbeddingResponse;
    for (const item of data.data) {
      results.push(item.embedding);
    }
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
