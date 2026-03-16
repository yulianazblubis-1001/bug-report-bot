import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export interface SlackMappingRow {
  phoneNumber: string;
  senderName: string;
  reportType: string;
  summary?: string;
  requestId?: string;
  farmerName?: string;
}

export async function ensureTable(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS slack_mappings (
      key TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      summary TEXT,
      request_id TEXT,
      farmer_name TEXT,
      stored_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )
  `);
  console.log('[SlackMapDB] Table ready');
}

export async function storeMapping(slackTs: string, channelId: string, data: SlackMappingRow): Promise<void> {
  const db = getPool();
  const key = `${channelId}:${slackTs}`;
  await db.query(
    `INSERT INTO slack_mappings (key, phone_number, sender_name, report_type, summary, request_id, farmer_name, stored_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (key) DO UPDATE SET
       phone_number = EXCLUDED.phone_number,
       sender_name = EXCLUDED.sender_name,
       report_type = EXCLUDED.report_type,
       summary = EXCLUDED.summary,
       request_id = EXCLUDED.request_id,
       farmer_name = EXCLUDED.farmer_name,
       stored_at = EXCLUDED.stored_at`,
    [key, data.phoneNumber, data.senderName, data.reportType, data.summary || null, data.requestId || null, data.farmerName || null, Date.now()]
  );
  console.log(`[SlackMapDB] Stored mapping for ${data.senderName} (${data.reportType}) key=${key}`);
}

export async function getMapping(slackTs: string, channelId: string): Promise<SlackMappingRow | null> {
  const db = getPool();
  const key = `${channelId}:${slackTs}`;
  const res = await db.query('SELECT * FROM slack_mappings WHERE key = $1', [key]);
  if (res.rows.length === 0) {
    console.log(`[SlackMapDB] No mapping found for key=${key}`);
    return null;
  }
  const row = res.rows[0];
  console.log(`[SlackMapDB] Found mapping for key=${key}: ${row.sender_name} (${row.report_type})`);
  return {
    phoneNumber: row.phone_number,
    senderName: row.sender_name,
    reportType: row.report_type,
    summary: row.summary,
    requestId: row.request_id,
    farmerName: row.farmer_name,
  };
}

export async function findMappingByRequestId(requestId: string): Promise<{ key: string; mapping: SlackMappingRow } | null> {
  const db = getPool();
  const res = await db.query('SELECT * FROM slack_mappings WHERE request_id = $1 LIMIT 1', [requestId]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    key: row.key,
    mapping: {
      phoneNumber: row.phone_number,
      senderName: row.sender_name,
      reportType: row.report_type,
      summary: row.summary,
      requestId: row.request_id,
      farmerName: row.farmer_name,
    },
  };
}

export async function pruneOldMappings(maxAgeDays = 30): Promise<void> {
  const db = getPool();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const res = await db.query('DELETE FROM slack_mappings WHERE stored_at < $1', [cutoff]);
  if (res.rowCount && res.rowCount > 0) {
    console.log(`[SlackMapDB] Pruned ${res.rowCount} old mappings`);
  }
}
