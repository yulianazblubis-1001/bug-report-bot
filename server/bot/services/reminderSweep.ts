import * as reportRegistry from './reportRegistry';
import { sendMessage } from './wati';
import { postSlackThreadReply } from './slack';

// Nudge when a posted report still has no ✅/❌ reaction in Slack ~23h25m after
// it was posted. That 23h25m mark is deliberately inside WhatsApp's 24-hour
// free-form messaging window (measured from the JA's last message), so the
// WhatsApp nudge still reaches the JA without needing a paid template.
const REMIND_AFTER_MS = (23 * 60 + 25) * 60 * 1000; // 23h25m
// Upper bound = the 24h WhatsApp window. Gating below it also prevents a first
// deploy from spamming reminders on a backlog of old, long-pending reports.
const REMIND_BEFORE_MS = 24 * 60 * 60 * 1000; // 24h
// Sweep faster than the (24h − 23h25m = 35m) window so no report is missed.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10m

// Statuses that mean the team already responded — never remind these.
const CLOSED_STATUSES = new Set(['DONE', 'REJECTED']);

let sweeping = false;

function ageMs(messageTs: string, now: number): number | null {
  // Slack ts is unix seconds with a microsecond suffix, e.g. "1786327882.500499".
  const seconds = parseFloat(messageTs);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return now - seconds * 1000;
}

async function sweepOnce(): Promise<void> {
  if (sweeping) return; // avoid overlapping runs if a sweep runs long
  sweeping = true;
  try {
    const entries = await reportRegistry.getAll();
    const now = Date.now();

    for (const { entry } of entries) {
      const status = (entry.status || '').toUpperCase();
      if (CLOSED_STATUSES.has(status)) continue; // already resolved/rejected
      if (entry.remindedAt) continue;            // already reminded once

      const age = ageMs(entry.messageTs, now);
      if (age === null) continue;
      if (age < REMIND_AFTER_MS || age >= REMIND_BEFORE_MS) continue;

      const name = entry.reporterName || 'there';
      const rn = entry.reportNumber ? ` (*${entry.reportNumber}*)` : '';
      const rnEN = entry.reportNumber ? ` ${entry.reportNumber}` : '';

      // 1) WhatsApp nudge to the JA (still inside the 24h window).
      if (entry.reporterPhone) {
        try {
          await sendMessage(
            entry.reporterPhone,
            `Halo ${name}! Laporan/permintaanmu${rn} masih dalam proses dan belum ada update dari tim. ` +
              `Balas pesan ini kalau ada info tambahan, atau tim akan segera menindaklanjuti.\n\n` +
              `_(Hi ${name}! Your report/request${rnEN} is still in progress with no update yet. ` +
              `Reply here if you have anything to add — the team will follow up shortly.)_`
          );
          console.log(`[ReminderSweep] WhatsApp nudge sent to ${entry.reporterPhone} for ts=${entry.messageTs}`);
        } catch (err: any) {
          const reason = err?.watiData?.message || err?.message || 'unknown';
          console.error(`[ReminderSweep] WhatsApp nudge failed for ${entry.reporterPhone}: ${reason}`);
        }
      }

      // 2) Slack thread reminder to the handling team.
      if (entry.channelId && entry.messageTs) {
        try {
          await postSlackThreadReply(
            entry.channelId,
            entry.messageTs,
            `⏰ Reminder: this report${rn} from ${name} has had no response for ~23 hours. ` +
              `Please react to close the loop:\n` +
              `• ✅ / :done: / :solved: — approved / solved / fixed\n` +
              `• ❌ / :no_bug: — rejected / not a bug`
          );
          console.log(`[ReminderSweep] Slack reminder posted for ts=${entry.messageTs}`);
        } catch (err: any) {
          console.error(`[ReminderSweep] Slack reminder failed for ts=${entry.messageTs}: ${err?.message || err}`);
        }
      }

      // Stamp once so it never fires again for this report (best-effort — even if
      // one channel failed, we don't want to re-spam the other on the next sweep).
      await reportRegistry.markReminded(entry.messageTs);
    }
  } catch (err: any) {
    console.error(`[ReminderSweep] Sweep failed: ${err?.message || err}`);
  } finally {
    sweeping = false;
  }
}

export function startReminderSweep(): void {
  console.log(`[ReminderSweep] Starting — checking every ${SWEEP_INTERVAL_MS / 60000}m for reports pending ~23h25m with no reaction`);
  const timer = setInterval(() => { void sweepOnce(); }, SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}
