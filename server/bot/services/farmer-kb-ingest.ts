import { getSheetsClient } from './google-auth';
import { embedTexts } from './voyage';
import { ensureTables, replaceChunksForSource } from '../farmer-kb-db';
import { quoteSheetName } from './sheet-range';

const LOCATION_HEADER_RE = /provinsi|kabupaten|kecamatan/i;
const MARKDOWN_TAB_MAX_CHARS = 1200;

function rowToChunkText(headers: string[], row: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]?.trim();
    const v = row[i]?.trim();
    if (h && v) parts.push(`${h}: ${v}`);
  }
  return parts.join('. ');
}

function extractLocationMeta(headers: string[], row: string[]): Record<string, string> {
  const meta: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (h && LOCATION_HEADER_RE.test(h) && row[i]) {
      meta[h.trim().toLowerCase()] = row[i].trim();
    }
  });
  return meta;
}

/** Splits long-form text (e.g. a markdown write-up pasted into a sheet cell) into paragraph-sized chunks. */
export function chunkLongText(text: string, maxChars = MARKDOWN_TAB_MAX_CHARS): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && (current.length + p.length + 2) > maxChars) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/** A tab holds long-form prose (not a data table) if its rows don't look like a wide, uniform header+rows table. */
function looksLikeLongFormTab(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  const headerCols = rows[0].length;
  if (headerCols > 2) return false;
  const avgCellLength =
    rows.reduce((sum, r) => sum + r.reduce((s, cell) => s + (cell?.length || 0), 0), 0) /
    Math.max(1, rows.reduce((n, r) => n + r.length, 0));
  return avgCellLength > 200;
}

export interface ResyncResult {
  tabsProcessed: string[];
  totalChunks: number;
}

/**
 * Full resync: re-reads every tab of the farmer knowledge-base Google Sheet,
 * re-chunks it, re-embeds every chunk, and replaces that tab's rows in
 * Postgres. Schema-agnostic on purpose — it works off whatever columns exist
 * in the sheet so editors don't need code changes when they add a column.
 */
export async function resyncKnowledgeBase(): Promise<ResyncResult> {
  await ensureTables();

  const sheetsId = process.env.GOOGLE_KB_SHEETS_ID;
  if (!sheetsId) {
    throw new Error('GOOGLE_KB_SHEETS_ID not set');
  }

  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetsId });
  const tabTitles = (spreadsheet.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);

  const tabsProcessed: string[] = [];
  let totalChunks = 0;

  for (const tabTitle of tabTitles) {
    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: quoteSheetName(tabTitle),
    });
    const rows = (valuesRes.data.values || []) as string[][];
    if (rows.length === 0) continue;

    let chunkTexts: string[] = [];
    let chunkMetas: Record<string, any>[] = [];

    if (looksLikeLongFormTab(rows)) {
      const fullText = rows.map((r) => r.join(' ')).join('\n\n');
      chunkTexts = chunkLongText(fullText);
      chunkMetas = chunkTexts.map(() => ({}));
    } else {
      const headers = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        const text = rowToChunkText(headers, row);
        if (!text) continue;
        chunkTexts.push(`[${tabTitle}] ${text}`);
        chunkMetas.push(extractLocationMeta(headers, row));
      }
    }

    if (chunkTexts.length === 0) continue;

    console.log(`[FarmerKbIngest] Embedding ${chunkTexts.length} chunks for tab "${tabTitle}"...`);
    const embeddings = await embedTexts(chunkTexts, 'document');
    const chunks = chunkTexts.map((text, i) => ({
      text,
      metadata: chunkMetas[i],
      embedding: embeddings[i],
    }));

    await replaceChunksForSource(tabTitle, chunks);
    tabsProcessed.push(tabTitle);
    totalChunks += chunks.length;
  }

  console.log(`[FarmerKbIngest] Resync complete: ${totalChunks} chunks across ${tabsProcessed.length} tabs`);
  return { tabsProcessed, totalChunks };
}
