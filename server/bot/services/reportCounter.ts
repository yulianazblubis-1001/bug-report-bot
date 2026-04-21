import * as fs from 'fs';
import * as path from 'path';

const COUNTER_FILE = path.join(process.cwd(), 'report_counter.json');

interface CounterStore {
  [dateTypeKey: string]: number;
}

let store: CounterStore = {};
let loaded = false;
const locks: Record<string, boolean> = {};

function getWIBDateString(): string {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).replace(/-/g, '');
}

function loadStore(): void {
  if (loaded) return;
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      const raw = fs.readFileSync(COUNTER_FILE, 'utf-8');
      store = JSON.parse(raw);
    }
  } catch {
    store = {};
  }
  loaded = true;
}

function saveStore(): void {
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(store, null, 2));
  } catch (err: any) {
    console.error('[ReportCounter] Failed to save counter file:', err.message);
  }
}

async function acquireLock(key: string): Promise<void> {
  while (locks[key]) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  locks[key] = true;
}

function releaseLock(key: string): void {
  delete locks[key];
}

export async function getNextReportNumber(type: 'BUG' | 'ADM' | 'CRD'): Promise<string> {
  loadStore();
  const date = getWIBDateString();
  const key = `${date}-${type}`;
  await acquireLock(key);
  try {
    const current = store[key] || 0;
    const next = current + 1;
    store[key] = next;
    saveStore();
    console.log(`[ReportCounter] Generated ${date}-${type}-${next}`);
    return `${date}-${type}-${next}`;
  } finally {
    releaseLock(key);
  }
}
