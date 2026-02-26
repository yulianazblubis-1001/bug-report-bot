import { sessionStore } from './session';
import type { BotSession } from './session';
import * as wati from './services/wati';
import * as slack from './services/slack';
import { evaluateReport } from './services/claude-agent';
import { addReportLog } from './activityLog';
import { isWhitelisted, lookupProfile, REJECTED_MSG } from './whitelist';

function getWelcomeMsg(name: string): string {
  return `Halo ${name}!

Mau lapor apa?

1 *Bug Report* — Laporkan masalah/error di app
2 *Admin Request* — Minta bantuan admin (reset password, dll)

Balas *1* atau *2*.

_(Reply 1 for Bug Report, 2 for Admin Request.)_`;
}

const INVALID_TYPE_MSG = `Maaf, saya tidak mengerti. Balas dengan:

1 untuk *Bug Report*
2 untuk *Admin Request*

_(Reply 1 or 2.)_`;

const BUG_START_MSG = `Jelaskan masalahnya. Tulis dengan bahasa kamu sendiri.

Yang wajib dilengkapi:
- PG siapa
- Versi app (cek di Settings)
- Platform (Android/iOS/Web)
- Screenshot atau video (wajib)

_(Describe the issue. Required: PG name, app version, platform, screenshot/video.)_`;

const ADMIN_START_MSG = `Jelaskan apa yang kamu butuhkan. Tulis dengan bahasa kamu sendiri.

_(Describe what you need in your own words.)_`;

const CONFIRM_ONLY_MSG = `Di langkah ini, saya hanya mengerti:

*KIRIM* — mengirim laporan
*ULANG* — mulai dari awal

_(Type KIRIM to submit, ULANG to restart.)_`;

export async function handleMessage(
  phoneNumber: string,
  senderName: string,
  text: string,
  messageType: string,
  mediaUrl: string | null
): Promise<void> {
  const cleanText = text ? text.trim() : '';
  const upperText = cleanText.toUpperCase();

  if (!isWhitelisted(phoneNumber)) {
    await wati.sendMessage(phoneNumber, REJECTED_MSG);
    return;
  }

  const profile = lookupProfile(phoneNumber);
  const displayName = profile?.name || senderName || phoneNumber;

  if (['START', 'MULAI', 'HI', 'HALO', 'HELLO', 'HAI', 'MENU'].includes(upperText)) {
    sessionStore.reset(phoneNumber);
    sessionStore.create(phoneNumber, senderName, profile);
    await wati.sendMessage(phoneNumber, getWelcomeMsg(displayName));
    return;
  }

  if (['CANCEL', 'BATAL'].includes(upperText)) {
    sessionStore.reset(phoneNumber);
    await wati.sendMessage(phoneNumber, `Laporan dibatalkan. Ketik *START* untuk mulai lagi, ${displayName}.\n\n_(Report cancelled. Type START to begin again.)_`);
    return;
  }

  let currentSession = sessionStore.get(phoneNumber);

  if (!currentSession) {
    currentSession = sessionStore.create(phoneNumber, senderName, profile);
    await wati.sendMessage(phoneNumber, getWelcomeMsg(displayName));
    return;
  }

  if (senderName && senderName !== phoneNumber) {
    currentSession.senderName = profile?.name || senderName;
  }

  if (currentSession.step === 'SELECT_TYPE') {
    if (cleanText === '1') {
      currentSession.reportType = 'bug';
      currentSession.step = 'COLLECTING';
      currentSession.conversation = [];
      currentSession.mediaUrls = [];
      currentSession.followUpCount = 0;
      currentSession.parsedReport = null;
      await wati.sendMessage(phoneNumber, BUG_START_MSG);
      return;
    }
    if (cleanText === '2') {
      currentSession.reportType = 'admin';
      currentSession.step = 'COLLECTING';
      currentSession.conversation = [];
      currentSession.mediaUrls = [];
      currentSession.followUpCount = 0;
      currentSession.parsedReport = null;
      await wati.sendMessage(phoneNumber, ADMIN_START_MSG);
      return;
    }
    await wati.sendMessage(phoneNumber, INVALID_TYPE_MSG);
    return;
  }

  if (currentSession.step === 'COLLECTING') {
    const msgHasMedia = messageType === 'image' || messageType === 'video' || messageType === 'document';
    const messageMediaUrls: string[] = [];

    if (msgHasMedia && mediaUrl) {
      currentSession.mediaUrls.push(mediaUrl);
      messageMediaUrls.push(mediaUrl);
    }

    if (!cleanText && msgHasMedia) {
      currentSession.conversation.push({
        role: 'user',
        text: '',
        mediaUrls: messageMediaUrls,
      });

      if (currentSession.conversation.length === 1) {
        await wati.sendMessage(phoneNumber, 'Terima kasih! Bisa jelaskan apa yang terjadi?');
        currentSession.conversation.push({
          role: 'assistant',
          text: 'Terima kasih! Bisa jelaskan apa yang terjadi?',
        });
        return;
      }
    } else {
      currentSession.conversation.push({
        role: 'user',
        text: cleanText,
        mediaUrls: messageMediaUrls.length > 0 ? messageMediaUrls : undefined,
      });
    }

    await wati.sendMessage(phoneNumber, 'Sedang menganalisis laporan kamu...');

    const hasScreenshot = currentSession.mediaUrls.length > 0;

    const result = await evaluateReport(
      currentSession.conversation,
      currentSession.reportType!,
      currentSession.followUpCount,
      hasScreenshot
    );

    currentSession.parsedReport = result.parsedReport;

    if (result.status === 'need_more_info' && result.followUpQuestion && currentSession.followUpCount < 3) {
      currentSession.followUpCount++;
      currentSession.conversation.push({
        role: 'assistant',
        text: result.followUpQuestion,
      });
      await wati.sendMessage(phoneNumber, result.followUpQuestion);
      return;
    }

    currentSession.step = 'CONFIRMING';
    const summary = buildSummary(currentSession);
    await wati.sendMessage(phoneNumber, summary);
    return;
  }

  if (currentSession.step === 'CONFIRMING') {
    if (isMediaType(messageType) && mediaUrl) {
      currentSession.mediaUrls.push(mediaUrl);
      await wati.sendMessage(phoneNumber, 'Foto/video ditambahkan.\n\nKetik *KIRIM* untuk mengirim laporan.\n\n_(Media added. Type KIRIM to submit.)_');
      return;
    }

    if (upperText === 'KIRIM' || upperText === 'SUBMIT' || upperText === 'SEND') {
      await submitReport(currentSession);
      return;
    }

    if (upperText === 'ULANG' || upperText === 'RESTART' || upperText === 'EDIT') {
      currentSession.step = 'COLLECTING';
      currentSession.conversation = [];
      currentSession.mediaUrls = [];
      currentSession.followUpCount = 0;
      currentSession.parsedReport = null;
      const startMsg = currentSession.reportType === 'bug' ? BUG_START_MSG : ADMIN_START_MSG;
      await wati.sendMessage(phoneNumber, 'Mulai ulang.\n\n' + startMsg);
      return;
    }

    await wati.sendMessage(phoneNumber, CONFIRM_ONLY_MSG);
    return;
  }
}

function isMediaType(messageType: string): boolean {
  return messageType === 'image' || messageType === 'video' || messageType === 'document';
}

function buildSummary(session: BotSession): string {
  const report = session.parsedReport || {};
  const mediaCount = session.mediaUrls.length;

  let summary = `*Ringkasan Laporan:*\n\n`;
  summary += `*${report.title || 'Report'}*\n`;

  if (report.description) {
    summary += `${report.description}\n`;
  }

  if (session.reportType === 'bug') {
    if (report.pgName) {
      summary += `\nPG: ${report.pgName}`;
    }
    if (report.farmerName) {
      summary += `\nFarmer: ${report.farmerName}`;
    }
    if (report.platform || report.appVersion) {
      summary += `\nPlatform: ${report.platform || '—'} | App: ${report.appVersion || '—'}`;
    }
    if (report.stepsToReproduce) {
      summary += `\nSteps: ${report.stepsToReproduce}`;
    }
  } else {
    if (report.accountAffected) {
      summary += `\nAccount: ${report.accountAffected}`;
    }
    if (report.urgency) {
      summary += `\nUrgency: ${report.urgency}`;
    }
  }

  if (mediaCount > 0) {
    summary += `\n\n${mediaCount} screenshot/video attached`;
  }

  summary += `\n\nKetik *KIRIM* untuk mengirim, atau *ULANG* untuk mulai ulang.`;
  summary += `\n\n_(Type KIRIM to submit, or ULANG to restart.)_`;

  return summary;
}

async function submitReport(session: BotSession): Promise<void> {
  const phoneNumber = session.phoneNumber;
  const displayName = session.profile?.name || session.senderName;

  try {
    await wati.sendMessage(phoneNumber, 'Sedang mengirim laporan...');

    await slack.postToSlack(session, (ts, channel) => {
      sessionStore.storeSlackMapping(ts, channel, {
        phoneNumber: session.phoneNumber,
        senderName: displayName,
        reportType: session.reportType!,
      });
    });

    const typeLabel = session.reportType === 'bug' ? 'Bug Report' : 'Admin Request';
    const report = session.parsedReport || {};

    addReportLog({
      type: session.reportType!,
      reporter: displayName,
      phoneNumber,
      summary: report.title || report.description || 'Report submitted',
      status: 'submitted',
    });

    let successMsg = `*${typeLabel} berhasil dikirim!*\n\nTim sudah dinotifikasi. Terima kasih, ${displayName}!`;
    if (session.mediaUrls.length > 0) {
      successMsg += `\n\nScreenshot/media sudah dilampirkan di laporan.`;
    }
    successMsg += `\n\nKetik *START* untuk laporan baru.\n\n_(${typeLabel} submitted successfully. Type START for a new report.)_`;

    await wati.sendMessage(phoneNumber, successMsg);
    sessionStore.reset(phoneNumber);
  } catch (err: any) {
    console.error('[Router] Submit failed:', err.message);
    await wati.sendMessage(
      phoneNumber,
      'Maaf, gagal mengirim laporan. Silakan coba lagi.\nKetik *KIRIM* untuk coba lagi, atau *ULANG* untuk mulai ulang.\n\n_(Failed to submit. Type KIRIM to retry, or ULANG to restart.)_'
    );
  }
}
