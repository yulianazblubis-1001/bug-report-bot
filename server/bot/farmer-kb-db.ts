import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (err) => {
      console.error('[FarmerKbDB] Pool error (connection will be retried):', err.message);
    });
  }
  return pool;
}

export interface KbChunk {
  id: number;
  source: string;
  chunkText: string;
  metadata: Record<string, any>;
  embedding: number[];
}

export async function ensureTables(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS farmer_kb_chunks (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      embedding DOUBLE PRECISION[] NOT NULL,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_farmer_kb_chunks_source ON farmer_kb_chunks (source)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS farmer_qa_log (
      id SERIAL PRIMARY KEY,
      phone_number TEXT NOT NULL,
      sender_name TEXT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      matched_sources TEXT[] NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
    )
  `);
  console.log('[FarmerKbDB] Tables ready');
}

/** Replaces all chunks for a given source (sheet tab) in one transaction — used by a full resync. */
export async function replaceChunksForSource(
  source: string,
  chunks: Array<{ text: string; metadata: Record<string, any>; embedding: number[] }>
): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM farmer_kb_chunks WHERE source = $1', [source]);
    for (const c of chunks) {
      await client.query(
        `INSERT INTO farmer_kb_chunks (source, chunk_text, metadata, embedding)
         VALUES ($1, $2, $3, $4)`,
        [source, c.text, JSON.stringify(c.metadata), c.embedding]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getAllChunks(): Promise<KbChunk[]> {
  await ensureTables();
  const db = getPool();
  const res = await db.query(
    'SELECT id, source, chunk_text, metadata, embedding FROM farmer_kb_chunks'
  );
  return res.rows.map((r) => ({
    id: r.id,
    source: r.source,
    chunkText: r.chunk_text,
    metadata: r.metadata,
    embedding: r.embedding,
  }));
}

export async function getChunkStats(): Promise<Array<{ source: string; count: number }>> {
  const db = getPool();
  const res = await db.query(
    'SELECT source, COUNT(*)::int AS count FROM farmer_kb_chunks GROUP BY source ORDER BY source'
  );
  return res.rows;
}

export async function logQa(entry: {
  phoneNumber: string;
  senderName?: string;
  question: string;
  answer: string;
  matchedSources: string[];
}): Promise<void> {
  try {
    await ensureTables();
    const db = getPool();
    await db.query(
      `INSERT INTO farmer_qa_log (phone_number, sender_name, question, answer, matched_sources)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.phoneNumber, entry.senderName || null, entry.question, entry.answer, entry.matchedSources]
    );
  } catch (err: any) {
    console.error('[FarmerKbDB] Failed to log Q&A:', err.message);
  }
}
