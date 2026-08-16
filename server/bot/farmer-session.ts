import type { FarmerTurn } from './services/farmer-qa';

const TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 12;

interface FarmerSessionEntry {
  history: FarmerTurn[];
  lastActivity: number;
}

const sessions = new Map<string, FarmerSessionEntry>();

export function getHistory(phoneNumber: string): FarmerTurn[] {
  const entry = sessions.get(phoneNumber);
  if (!entry) return [];
  if (Date.now() - entry.lastActivity > TTL_MS) {
    sessions.delete(phoneNumber);
    return [];
  }
  return entry.history;
}

export function appendTurn(phoneNumber: string, role: 'user' | 'assistant', text: string): void {
  let entry = sessions.get(phoneNumber);
  if (!entry) {
    entry = { history: [], lastActivity: Date.now() };
    sessions.set(phoneNumber, entry);
  }
  entry.history.push({ role, text });
  if (entry.history.length > MAX_TURNS) {
    entry.history = entry.history.slice(-MAX_TURNS);
  }
  entry.lastActivity = Date.now();
}

setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of sessions.entries()) {
    if (now - entry.lastActivity > TTL_MS) sessions.delete(phone);
  }
}, 5 * 60 * 1000);
