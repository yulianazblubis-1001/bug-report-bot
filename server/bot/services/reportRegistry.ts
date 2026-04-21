import {
  appendRegistryEntry,
  getRegistryEntry,
  markRegistryResolved,
} from './google-sheets';

export interface RegistryRecord {
  messageTs: string;
  channelId: string;
  reportNumber: string;
  phone: string;
  name: string;
  type: 'bug' | 'admin' | 'credit';
}

export interface RegistryLookup {
  reportNumber: string;
  phone: string;
  name: string;
  type: string;
  status: string;
}

export async function set(record: RegistryRecord): Promise<void> {
  try {
    await appendRegistryEntry({
      messageTs:     record.messageTs,
      channelId:     record.channelId,
      reportNumber:  record.reportNumber,
      reporterPhone: record.phone,
      reporterName:  record.name,
      reportType:    record.type,
    });
  } catch (err: any) {
    console.error('[ReportRegistry] Failed to save entry:', err.message);
  }
}

export async function get(messageTs: string): Promise<RegistryLookup | null> {
  try {
    const found = await getRegistryEntry(messageTs);
    if (!found) return null;
    return {
      reportNumber: found.entry.reportNumber,
      phone:        found.entry.reporterPhone,
      name:         found.entry.reporterName,
      type:         found.entry.reportType,
      status:       found.entry.status,
    };
  } catch (err: any) {
    console.error('[ReportRegistry] Failed to get entry:', err.message);
    return null;
  }
}

export async function markResolved(messageTs: string): Promise<void> {
  try {
    await markRegistryResolved(messageTs);
  } catch (err: any) {
    console.error('[ReportRegistry] Failed to mark resolved:', err.message);
  }
}
