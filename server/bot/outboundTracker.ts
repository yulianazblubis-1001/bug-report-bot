import { cleanNumber } from './whitelist';

// Tracks the last time we sent an outbound WhatsApp message (session message
// or template) to a number. Used as a safety net so the farmer auto-answer
// pipeline briefly backs off after we've just messaged someone — catching
// acknowledgement replies ("Ya, benar", "ok makasih") that the intent
// classifier in farmer-flow.ts might miss. See recordSent() call sites in
// services/wati.ts.
const WINDOW_MS = 5 * 60 * 1000;

const recentSends = new Map<string, number>();

export function recordSent(phoneNumber: string): void {
  const cleaned = cleanNumber(phoneNumber);
  recentSends.set(cleaned, Date.now());
}

export function wasRecentlySentTo(phoneNumber: string): boolean {
  const cleaned = cleanNumber(phoneNumber);
  const sentAt = recentSends.get(cleaned);
  if (!sentAt) return false;
  if (Date.now() - sentAt > WINDOW_MS) {
    recentSends.delete(cleaned);
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [phone, sentAt] of recentSends.entries()) {
    if (now - sentAt > WINDOW_MS) recentSends.delete(phone);
  }
}, 60 * 1000).unref();
