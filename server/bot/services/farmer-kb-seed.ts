import * as fs from 'fs';
import * as path from 'path';
import { getSheetsClient } from './google-auth';
import { parseCsv } from './csv-utils';
import { chunkLongText } from './farmer-kb-ingest';
import { quoteSheetName } from './sheet-range';

const DATA_DIR = path.join(process.cwd(), 'server', 'bot', 'data', 'farmer-kb');

/**
 * One-time seeding of the farmer knowledge-base Google Sheet from the files
 * extracted out of the NotebookLM notebook (server/bot/data/farmer-kb/).
 * After this runs once, the Sheet — not these files — is the source of
 * truth; edits happen there, and services/farmer-kb-ingest.ts resyncs FROM
 * the Sheet into the vector store.
 *
 * Only datasets that reconstructed into a reliable row/column structure are
 * seeded here. Pest & Disease, Product, and Weed Management came out of
 * NotebookLM's rendered view as one-value-per-line text with no reliable way
 * to tell where blank cells were, so auto-splitting them risked silently
 * misaligning chemical/treatment data — they are intentionally skipped.
 */
const TABULAR_FILES: Array<{ file: string; tab: string }> = [
  { file: 'fertilizer-recommendation.csv', tab: 'Fertilizer Recommendation' },
  { file: 'pk-testing.csv', tab: 'P&K Testing' },
  { file: 'rice-varieties.csv', tab: 'Rice Varieties' },
];

const LONGFORM_FILES: Array<{ file: string; tab: string }> = [
  { file: 'crop-calendar.md', tab: 'Crop Calendar' },
];

async function ensureTabExists(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  spreadsheetId: string,
  tabTitle: string
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = (meta.data.sheets || []).some((s) => s.properties?.title === tabTitle);
  if (existing) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabTitle } } }],
    },
  });
}

export interface SeedResult {
  tabsWritten: string[];
  tabsSkipped: string[];
}

export async function seedSheetFromLocalFiles(): Promise<SeedResult> {
  const spreadsheetId = process.env.GOOGLE_KB_SHEETS_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_KB_SHEETS_ID not set');
  }

  const sheets = await getSheetsClient();
  const tabsWritten: string[] = [];
  const tabsSkipped: string[] = [];

  for (const { file, tab } of TABULAR_FILES) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      tabsSkipped.push(tab);
      continue;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const rows = parseCsv(raw);
    if (rows.length === 0) {
      tabsSkipped.push(tab);
      continue;
    }

    await ensureTabExists(sheets, spreadsheetId, tab);
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: quoteSheetName(tab) });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetName(tab)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
    tabsWritten.push(tab);
  }

  for (const { file, tab } of LONGFORM_FILES) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      tabsSkipped.push(tab);
      continue;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const chunks = chunkLongText(raw, 2000);
    const rows = chunks.map((c) => [c]);

    await ensureTabExists(sheets, spreadsheetId, tab);
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: quoteSheetName(tab) });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetName(tab)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
    tabsWritten.push(tab);
  }

  return { tabsWritten, tabsSkipped };
}
