import { getNextCounterValue } from './google-sheets';

// In-process lock to prevent duplicate numbers from concurrent requests
const locks: Record<string, boolean> = {};

function getWIBDateString(): string {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).replace(/-/g, '');
}

async function acquireLock(key: string): Promise<void> {
  while (locks[key]) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  locks[key] = true;
}

function releaseLock(key: string): void {
  delete locks[key];
}

export async function getNextReportNumber(type: 'BUG' | 'ADM' | 'CRD'): Promise<string> {
  const date = getWIBDateString();
  const key = `${date}-${type}`;
  await acquireLock(key);
  try {
    const next = await getNextCounterValue(date, type);
    const reportNumber = `${date}-${type}-${next}`;
    console.log(`[ReportCounter] Generated ${reportNumber}`);
    return reportNumber;
  } finally {
    releaseLock(key);
  }
}
