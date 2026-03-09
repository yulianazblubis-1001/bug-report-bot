import { sessionStore } from './session';
import type { BotSession } from './session';
import * as wati from './services/wati';
import * as slack from './services/slack';
import { evaluateReport } from './services/claude-agent';
import { addReportLog } from './activityLog';
import { isWhitelisted, lookupProfile, REJECTED_MSG } from './whitelist';
import * as creditLimitFlow from './flows/creditLimitTopUp';
import * as googleSheets from './services/google-sheets';
import * as googleDrive from './services/google-drive';
import { v4 as uuidv4 } from 'uuid';

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

const ADMIN_SUBMENU_MSG = `🛠️ *Admin Request*

Pilih jenis permintaan:

1️⃣ General Request (reset password, dll)
2️⃣ Credit Limit Top Up

Balas 1 atau 2.

_(Choose request type: 1 for General, 2 for Credit Limit Top Up)_`;

const BUG_START_MSG = `Jelaskan masalahnya. Tulis dengan bahasa kamu sendiri.

Yang wajib dilengkapi:
- PG siapa
- Langkah-langkah kejadian (steps to reproduce)
- Versi app (cek di Settings)
- Platform (Android/iOS/Web)
- Screenshot atau video (wajib)

_(Describe the issue. Required: PG name, steps to reproduce, app version, platform, screenshot/video.)_`;

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

  const TRIGGER_KEYWORDS = ['BUG', 'REPORT', 'ADMIN', 'REQUEST', 'START', 'MULAI', 'MENU', 'LAPOR'];

  if (!isWhitelisted(phoneNumber)) {
    const isTrigger = TRIGGER_KEYWORDS.some(kw => upperText.includes(kw));
    if (isTrigger) {
      await wati.sendMessage(phoneNumber, REJECTED_MSG);
    } else {
      console.log(`[Router] Ignoring message from non-whitelisted ${phoneNumber}: "${cleanText.substring(0, 50)}"`);
    }
    return;
  }

  const profile = lookupProfile(phoneNumber);
  const displayName = profile?.name || senderName || phoneNumber;

  let currentSession = sessionStore.get(phoneNumber);

  const firstWord = upperText.split(/[\s\n]/)[0];
  const isTriggerMessage = TRIGGER_KEYWORDS.some(kw => firstWord === kw || upperText.startsWith(kw));

  if (isTriggerMessage && !currentSession) {
    sessionStore.reset(phoneNumber);
    currentSession = sessionStore.create(phoneNumber, senderName, profile);
    await wati.sendMessage(phoneNumber, getWelcomeMsg(displayName));
    return;
  }

  if (['START', 'MULAI', 'MENU'].includes(firstWord) && currentSession) {
    sessionStore.reset(phoneNumber);
    currentSession = sessionStore.create(phoneNumber, senderName, profile);
    await wati.sendMessage(phoneNumber, getWelcomeMsg(displayName));
    return;
  }

  if (['CANCEL', 'BATAL'].includes(firstWord)) {
    if (currentSession) {
      sessionStore.reset(phoneNumber);
      await wati.sendMessage(phoneNumber, `Laporan dibatalkan. Ketik *START* untuk mulai lagi, ${displayName}.\n\n_(Report cancelled. Type START to begin again.)_`);
    }
    return;
  }

  if (!currentSession) {
    console.log(`[Router] Ignoring message from whitelisted ${phoneNumber} (no active session): "${cleanText.substring(0, 50)}"`);
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
      currentSession.step = 'SELECT_ADMIN_TYPE';
      await wati.sendMessage(phoneNumber, ADMIN_SUBMENU_MSG);
      return;
    }
    await wati.sendMessage(phoneNumber, INVALID_TYPE_MSG);
    return;
  }

  if (currentSession.step === 'SELECT_ADMIN_TYPE') {
    if (cleanText === '1') {
      currentSession.reportType = 'admin';
      currentSession.step = 'COLLECTING';
      currentSession.conversation = [];
      currentSession.mediaUrls = [];
      currentSession.followUpCount = 0;
      currentSession.parsedReport = null;
      await wati.sendMessage(phoneNumber, ADMIN_START_MSG);
      return;
    }
    if (cleanText === '2') {
      currentSession.reportType = 'creditTopUp';
      currentSession.step = 'COLLECTING';
      currentSession.data = { _stepIndex: 0 };
      currentSession.mediaUrls = [];
      const firstQ = creditLimitFlow.getFirstQuestion();
      await wati.sendMessage(phoneNumber, `🏦 *Credit Limit Top Up*\n\nSaya akan memandu kamu step-by-step.\n\n${firstQ}`);
      return;
    }
    await wati.sendMessage(phoneNumber, `Balas *1* untuk General Request atau *2* untuk Credit Limit Top Up.\n\n_(Reply 1 or 2.)_`);
    return;
  }

  if (currentSession.step === 'COLLECTING') {
    if (currentSession.reportType === 'creditTopUp') {
      return handleCreditLimitCollecting(currentSession, phoneNumber, cleanText, messageType, mediaUrl);
    }

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
      if (currentSession.reportType === 'creditTopUp') {
        await submitCreditLimitReport(currentSession);
      } else {
        await submitReport(currentSession);
      }
      return;
    }

    if (upperText === 'ULANG' || upperText === 'RESTART' || upperText === 'EDIT') {
      if (currentSession.reportType === 'creditTopUp') {
        currentSession.step = 'COLLECTING';
        currentSession.data = { _stepIndex: 0 };
        currentSession.mediaUrls = [];
        const firstQ = creditLimitFlow.getFirstQuestion();
        await wati.sendMessage(phoneNumber, `Mulai ulang.\n\n${firstQ}`);
      } else {
        currentSession.step = 'COLLECTING';
        currentSession.conversation = [];
        currentSession.mediaUrls = [];
        currentSession.followUpCount = 0;
        currentSession.parsedReport = null;
        const startMsg = currentSession.reportType === 'bug' ? BUG_START_MSG : ADMIN_START_MSG;
        await wati.sendMessage(phoneNumber, 'Mulai ulang.\n\n' + startMsg);
      }
      return;
    }

    await wati.sendMessage(phoneNumber, CONFIRM_ONLY_MSG);
    return;
  }
}

async function handleCreditLimitCollecting(
  session: BotSession,
  phoneNumber: string,
  text: string,
  messageType: string,
  mediaUrl: string | null
): Promise<void> {
  const msgHasMedia = messageType === 'image' || messageType === 'video' || messageType === 'document';

  const result = creditLimitFlow.processStep(session, text, msgHasMedia ? mediaUrl : null);

  if (result.error) {
    await wati.sendMessage(phoneNumber, result.error);
    return;
  }

  if (result.showSummary && result.summary) {
    session.step = 'CONFIRMING';
    await wati.sendMessage(phoneNumber, result.summary);
    return;
  }

  if (result.nextQuestion) {
    await wati.sendMessage(phoneNumber, result.nextQuestion);
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

function getWIBTimestamp(): string {
  const now = new Date();
  return now.toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' WIB';
}

async function submitCreditLimitReport(session: BotSession): Promise<void> {
  const phoneNumber = session.phoneNumber;
  const displayName = session.profile?.name || session.senderName;
  const d = session.data;

  try {
    await wati.sendMessage(phoneNumber, 'Sedang mengirim permintaan credit limit top up...');

    const requestId = uuidv4().substring(0, 8).toUpperCase();
    const timestamp = getWIBTimestamp();

    const docFields = ['docSignedSO', 'docFarmerHolding', 'docLandOwnership', 'docJaminan'];
    const driveUrls: Record<string, string> = {};

    for (const field of docFields) {
      if (d[field] && typeof d[field] === 'string' && d[field].startsWith('http')) {
        try {
          console.log(`[CreditLimit] Uploading ${field} to Google Drive...`);
          const { buffer, mimeType, ext } = await googleDrive.downloadFromWati(d[field]);
          const fileName = `${requestId}_${field}.${ext}`;
          const driveUrl = await googleDrive.uploadToDrive(buffer, fileName, mimeType);
          driveUrls[field] = driveUrl;
        } catch (err: any) {
          console.error(`[CreditLimit] Failed to upload ${field} to Drive:`, err.message);
          driveUrls[field] = d[field];
        }
      }
    }

    const slackData = {
      ...d,
      requestId,
      timestamp,
      docSignedSO: driveUrls.docSignedSO || d.docSignedSO || '',
      docFarmerHolding: driveUrls.docFarmerHolding || d.docFarmerHolding || '',
      docLandOwnership: driveUrls.docLandOwnership || d.docLandOwnership || '',
      docJaminan: driveUrls.docJaminan || d.docJaminan || '',
    };

    const slackResult = await slack.postCreditLimitToSlack(session, slackData, (ts, channel) => {
      sessionStore.storeSlackMapping(ts, channel, {
        phoneNumber: session.phoneNumber,
        senderName: displayName,
        reportType: 'creditTopUp',
        requestId,
        farmerName: d.farmerName,
      });
    });

    const sheetRow: googleSheets.CreditLimitRow = {
      timestamp,
      requestId,
      reporterName: displayName,
      reporterPhone: phoneNumber,
      fgName: d.fgName || '',
      farmerName: d.farmerName || '',
      landSizeVerified: d.landParcelSize || '',
      currentLimit: d.currentLimit || '',
      requestedTopUp: d.requestedTopUp || '',
      creditType: d.creditType || '',
      reason: d.reason || '',
      soNumber: d.soNumber || '',
      docSignedSO: driveUrls.docSignedSO || d.docSignedSO || '',
      docFarmerHolding: driveUrls.docFarmerHolding || d.docFarmerHolding || '',
      docLandOwnership: driveUrls.docLandOwnership || d.docLandOwnership || '',
      docJaminan: driveUrls.docJaminan || d.docJaminan || '',
      status: 'PENDING',
      reviewedBy: '',
      reviewDate: '',
      rejectionReason: '',
      slackMessageTs: slackResult.ts || '',
    };

    try {
      await googleSheets.appendRequest(sheetRow);
    } catch (err: any) {
      console.error('[CreditLimit] Failed to write to Google Sheets:', err.message);
    }

    addReportLog({
      type: 'creditTopUp',
      reporter: displayName,
      phoneNumber,
      summary: `Credit Limit Top Up — ${d.farmerName} — ${d.creditType}`,
      status: 'submitted',
    });

    let successMsg = `*Credit Limit Top Up berhasil dikirim!*\n\n`;
    successMsg += `Request ID: *${requestId}*\n`;
    successMsg += `Farmer: ${d.farmerName}\n`;
    successMsg += `Tim Ops Excellence sudah dinotifikasi dan akan review permintaan kamu.\n\n`;
    successMsg += `Kamu akan mendapat notifikasi saat permintaan di-approve atau di-reject.\n\n`;
    successMsg += `Ketik *START* untuk permintaan baru.\n\n`;
    successMsg += `_(Credit Limit Top Up submitted. Request ID: ${requestId}. You'll be notified when it's approved or rejected. Type START for a new request.)_`;

    await wati.sendMessage(phoneNumber, successMsg);
    sessionStore.reset(phoneNumber);
  } catch (err: any) {
    console.error('[Router] Credit limit submit failed:', err.message);
    await wati.sendMessage(
      phoneNumber,
      'Maaf, gagal mengirim permintaan. Silakan coba lagi.\nKetik *KIRIM* untuk coba lagi, atau *ULANG* untuk mulai ulang.\n\n_(Failed to submit. Type KIRIM to retry, or ULANG to restart.)_'
    );
  }
}
