export interface ReportLogEntry {
  id: number;
  type: string;
  reporter: string;
  phoneNumber: string;
  summary: string;
  status: string;
  timestamp: string;
}

const MAX_LOGS = 100;
let logIdCounter = 0;
const logs: ReportLogEntry[] = [];

export function addReportLog(entry: Omit<ReportLogEntry, 'id' | 'timestamp'>): void {
  logIdCounter++;
  logs.unshift({
    ...entry,
    id: logIdCounter,
    timestamp: new Date().toISOString(),
  });
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }
}

export function getReportLogs(): ReportLogEntry[] {
  return logs;
}

export function getStats(): { total: number; bugs: number; admins: number; today: number } {
  const today = new Date().toISOString().split('T')[0];
  return {
    total: logs.length,
    bugs: logs.filter((l) => l.type === 'bug').length,
    admins: logs.filter((l) => l.type === 'admin').length,
    today: logs.filter((l) => l.timestamp.startsWith(today)).length,
  };
}
