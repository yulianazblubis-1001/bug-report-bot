import { sessionStore } from './session';
import type { BotSession } from './session';
import * as wati from './services/wati';
import * as slack from './services/slack';
import { evaluateReport } from './services/claude-agent';
import { addReportLog } from './activityLog';
import { isWhitelisted, lookupProfile, REJECTED_MSG } from './whitelist';
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

const CREDIT_TYPE_SUBMENU_MSG = `🏦 *Credit Limit Top Up*

Pilih jenis pengajuan:

1️⃣ Top-Up Credit (Lahan < 2.5 Ha)
2️⃣ Petani Besar / Large Farmer (Lahan > 2.5 Ha s/d 5 Ha)

Balas 1 atau 2.

_(Choose type: 1 for Standard, 2 for Large Farmer)_`;

const CREDIT_LIMIT_START_MSG = `🏦 *Credit Limit Top Up*

Saya akan tanya data satu per satu ya.

Pertama, siapa *nama Farmer Group (FG)*-nya?

_(I'll ask for information step by step. First: what is the Farmer Group (FG) name?)_`;

const CREDIT_LIMIT_LARGE_START_MSG = `🏦 *Credit Limit Top Up — Petani Besar*

Saya akan tanya data satu per satu ya.

Pertama, siapa *nama Farmer Group (FG)*-nya?

_(I'll ask for information step by step. First: what is the Farmer Group (FG) name?)_`;

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
      currentSession.step = 'SELECT_CREDIT_TYPE';
      await wati.sendMessage(phoneNumber, CREDIT_TYPE_SUBMENU_MSG);
      return;
    }
    await wati.sendMessage(phoneNumber, `Balas *1* untuk General Request atau *2* untuk Credit Limit Top Up.\n\n_(Reply 1 or 2.)_`);
    return;
  }

  if (currentSession.step === 'SELECT_CREDIT_TYPE') {
    if (cleanText === '1') {
      currentSession.reportType = 'creditTopUp';
      currentSession.creditLimitType = 'standard';
      currentSession.step = 'COLLECTING';
      currentSession.conversation = [];
      currentSession.mediaUrls = [];
      currentSession.followUpCount = 0;
      currentSession.parsedReport = null;
      currentSession.data = {};
      await wati.sendMessage(phoneNumber, CREDIT_LIMIT_START_MSG);
      return;
    }
    if (cleanText === '2') {
      currentSession.reportType = 'creditTopUp';
      currentSession.creditLimitType = 'largeFarmer';
      currentSession.step = 'COLLECTING';
      currentSession.conversation = [];
      currentSession.mediaUrls = [];
      currentSession.followUpCount = 0;
      currentSession.parsedReport = null;
      currentSession.data = {};
      await wati.sendMessage(phoneNumber, CREDIT_LIMIT_LARGE_START_MSG);
      return;
    }
    await wati.sendMessage(phoneNumber, `Balas *1* untuk Top-Up Credit (< 2.5 Ha) atau *2* untuk Petani Besar (> 2.5 Ha).\n\n_(Reply 1 or 2.)_`);
    return;
  }

  if (currentSession.step === 'COLLECTING') {
    const msgHasMedia = messageType === 'image' || messageType === 'video' || messageType === 'document';

    if (msgHasMedia && mediaUrl) {
      currentSession.mediaUrls.push(mediaUrl);
    }

    if (currentSession.isProcessing) {
      if (msgHasMedia && mediaUrl) {
        currentSession.pendingMediaUrls.push(mediaUrl);
        console.log(`[Router] Media queued while processing for ${phoneNumber} (pending: ${currentSession.pendingMediaUrls.length})`);
      } else if (cleanText) {
        console.log(`[Router] Text ignored while processing for ${phoneNumber}: "${cleanText.substring(0, 60)}"`);
      }
      return;
    }

    const messageMediaUrls: string[] = [];
    if (msgHasMedia && mediaUrl) {
      messageMediaUrls.push(mediaUrl);
    }

    if (!cleanText && msgHasMedia) {
      currentSession.conversation.push({
        role: 'user',
        text: '',
        mediaUrls: messageMediaUrls,
      });

      if (currentSession.conversation.length === 1) {
        const promptMsg = currentSession.reportType === 'creditTopUp'
          ? 'Terima kasih untuk dokumennya. Sekarang jelaskan permintaan credit limit top up kamu.'
          : 'Terima kasih! Bisa jelaskan apa yang terjadi?';
        await wati.sendMessage(phoneNumber, promptMsg);
        currentSession.conversation.push({
          role: 'assistant',
          text: promptMsg,
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

    currentSession.isProcessing = true;
    try {
      const analyzingMsg = currentSession.reportType === 'creditTopUp'
        ? 'Sedang memproses data kamu...'
        : 'Sedang menganalisis laporan kamu...';
      await wati.sendMessage(phoneNumber, analyzingMsg);

      const hasScreenshot = currentSession.mediaUrls.length > 0;
      const isLargeFarmer = currentSession.creditLimitType === 'largeFarmer';
      const maxFollowUps = currentSession.reportType === 'creditTopUp' ? (isLargeFarmer ? 12 : 8) : 3;

      const result = await evaluateReport(
        currentSession.conversation,
        currentSession.reportType!,
        currentSession.followUpCount,
        hasScreenshot,
        currentSession.creditLimitType
      );

      if (result.parsedReport && Object.keys(result.parsedReport).length > 0) {
        currentSession.parsedReport = {
          ...(currentSession.parsedReport || {}),
          ...result.parsedReport,
        };
      }

      if (currentSession.pendingMediaUrls.length > 0) {
        console.log(`[Router] Flushing ${currentSession.pendingMediaUrls.length} pending media for ${phoneNumber}`);
        for (const pendingUrl of currentSession.pendingMediaUrls) {
          if (!currentSession.mediaUrls.includes(pendingUrl)) {
            currentSession.mediaUrls.push(pendingUrl);
          }
          currentSession.conversation.push({ role: 'user', text: '', mediaUrls: [pendingUrl] });
        }
        currentSession.pendingMediaUrls = [];
      }

      if (result.status === 'need_more_info' && result.followUpQuestion && currentSession.followUpCount < maxFollowUps) {
        currentSession.followUpCount++;
        currentSession.conversation.push({
          role: 'assistant',
          text: result.followUpQuestion,
        });
        await wati.sendMessage(phoneNumber, result.followUpQuestion);
        return;
      }

      if (currentSession.reportType === 'creditTopUp' && result.parsedReport) {
        const r = result.parsedReport;
        const coreFields = [r.fgName, r.farmerName, r.landParcelSize, r.currentLimit, r.requestedTopUp];
        const allNull = coreFields.every((f: any) => !f || f === 'null');
        if (allNull) {
          const incompleteMsg = '⚠️ Data belum lengkap. Silakan ketik *ULANG* dan kirim data yang lengkap.\n\n_(Data is incomplete. Type ULANG to restart and provide complete data.)_';
          await wati.sendMessage(phoneNumber, incompleteMsg);
          return;
        }
      }

      currentSession.step = 'CONFIRMING';
      const summary = currentSession.reportType === 'creditTopUp'
        ? buildCreditLimitSummary(currentSession)
        : buildSummary(currentSession);
      await wati.sendMessage(phoneNumber, summary);
      return;
    } catch (err: any) {
      console.error('[Router] COLLECTING error:', err.message);
      await wati.sendMessage(
        phoneNumber,
        'Maaf, ada kesalahan saat memproses. Coba ketik *ULANG* untuk mulai ulang, atau *START* untuk kembali ke menu utama.\n\n_(Error while processing. Type ULANG to restart.)_'
      );
    } finally {
      currentSession.isProcessing = false;
    }
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
      currentSession.step = 'COLLECTING';
      currentSession.conversation = [];
      currentSession.mediaUrls = [];
      currentSession.pendingMediaUrls = [];
      currentSession.followUpCount = 0;
      currentSession.parsedReport = null;
      currentSession.data = {};
      currentSession.isProcessing = false;
      let startMsg = BUG_START_MSG;
      if (currentSession.reportType === 'creditTopUp') {
        startMsg = currentSession.creditLimitType === 'largeFarmer' ? CREDIT_LIMIT_LARGE_START_MSG : CREDIT_LIMIT_START_MSG;
      } else if (currentSession.reportType === 'admin') startMsg = ADMIN_START_MSG;
      await wati.sendMessage(phoneNumber, 'Mulai ulang.\n\n' + startMsg);
      return;
    }

    await wati.sendMessage(phoneNumber, CONFIRM_ONLY_MSG);
    return;
  }

  console.warn(`[Router] Unhandled state for ${phoneNumber}: step=${currentSession.step} type=${currentSession.reportType} text="${cleanText.substring(0, 60)}"`);
  await wati.sendMessage(
    phoneNumber,
    `Maaf, saya tidak bisa memproses pesan ini. Ketik *ULANG* untuk mulai ulang, atau *START* untuk kembali ke menu utama.\n\n_(Can't process this message. Type ULANG to restart or START for main menu.)_`
  );
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

function buildCreditLimitSummary(session: BotSession): string {
  const report = session.parsedReport || {};
  const mediaCount = session.mediaUrls.length;
  const isLargeFarmer = session.creditLimitType === 'largeFarmer';
  const creditType = report.creditType || '—';
  const includesAgriInput = creditType.includes('Agri Input');
  const includesMechanization = creditType.includes('Mechanization');

  let summary = `*Ringkasan Credit Limit Top Up:*\n\n`;
  summary += `*${report.title || '[Credit Limit] Top Up Request'}*\n\n`;
  summary += `*FG:* ${report.fgName || '—'}\n`;
  summary += `*Farmer:* ${report.farmerName || '—'}\n`;
  summary += `*Luas Lahan:* ${report.landParcelSize || '—'} Ha`;
  if (isLargeFarmer) summary += ` ⚠️ PETANI BESAR`;
  summary += `\n`;
  summary += `*Credit Limit Sekarang:* ${report.currentLimit || '—'}\n`;
  summary += `*Top Up:* ${report.requestedTopUp || '—'}\n`;
  summary += `*Jenis Credit:* ${creditType}\n`;
  summary += `*Alasan:* ${report.reason || '—'}\n`;

  if (includesAgriInput && report.soNumber) {
    summary += `*Nomor SO:* ${report.soNumber}\n`;
  }

  if (isLargeFarmer) {
    summary += `\n*--- Petani Besar ---*\n`;
    if (report.farmerIncomeSources) summary += `*Sumber Pendapatan:* ${report.farmerIncomeSources}\n`;
    if (report.businessPotential) summary += `*Potensi Bisnis:* ${report.businessPotential}\n`;
    if (report.collateralType) summary += `*Jenis Jaminan:* ${report.collateralType}\n`;
    if (report.creditLimitRequestAmount) summary += `*Limit Kredit Diminta:* ${report.creditLimitRequestAmount}\n`;
  }

  summary += `\n*Dokumen:* ${mediaCount} file terlampir`;

  if (report.documentsReceived) {
    const docs = report.documentsReceived;
    if (includesAgriInput) {
      summary += `\n  - Signed SO ${docs.signedSO ? '✅' : '❌'}`;
      summary += `\n  - Farmer holding SO ${docs.farmerHoldingSO ? '✅' : '❌'}`;
    }
    if (includesMechanization) {
      summary += `\n  - Signed Request Letter ${docs.signedRequestLetter ? '✅' : '❌'}`;
      summary += `\n  - Farmer holding Request Letter ${docs.farmerHoldingRequestLetter ? '✅' : '❌'}`;
    }
    if (isLargeFarmer) {
      summary += `\n  - Bukti kepemilikan lahan ${docs.landOwnershipProof ? '✅' : '❌'}`;
      summary += `\n  - Foto jaminan ${docs.collateralPhoto ? '✅' : '❌'}`;
      summary += `\n  - Sertifikat jaminan ${docs.collateralCertificate ? '✅' : '❌'}`;
    }
  }

  summary += `\n\nKetik *KIRIM* untuk mengirim permintaan.`;
  summary += `\nKetik *ULANG* untuk mulai dari awal.`;
  summary += `\n\n_(Type KIRIM to submit, or ULANG to restart.)_`;

  return summary;
}

async function submitCreditLimitReport(session: BotSession): Promise<void> {
  const phoneNumber = session.phoneNumber;
  const displayName = session.profile?.name || session.senderName;
  const report = session.parsedReport || {};
  const isLargeFarmer = session.creditLimitType === 'largeFarmer';
  const creditType = report.creditType || '';
  const includesAgriInput = creditType.includes('Agri Input');
  const includesMechanization = creditType.includes('Mechanization');

  try {
    await wati.sendMessage(phoneNumber, 'Sedang mengirim permintaan credit limit top up...');

    const requestId = uuidv4().substring(0, 8).toUpperCase();
    const timestamp = getWIBTimestamp();

    const driveUrls: Record<string, string> = {};
    const docLabels: string[] = [];
    if (includesAgriInput) {
      docLabels.push('docSignedSO', 'docFarmerHoldingSO');
    }
    if (includesMechanization) {
      docLabels.push('docSignedRequestLetter', 'docFarmerHoldingRequestLetter');
    }
    if (isLargeFarmer) {
      docLabels.push('docLandOwnership', 'docCollateralPhoto', 'docCollateralCertificate');
    }

    for (let i = 0; i < session.mediaUrls.length && i < docLabels.length; i++) {
      const mediaUrl = session.mediaUrls[i];
      const label = docLabels[i];
      try {
        console.log(`[CreditLimit] Uploading media ${i + 1} as ${label} to Google Drive...`);
        const { buffer, mimeType, ext } = await googleDrive.downloadFromWati(mediaUrl);
        const fileName = `${requestId}_${label}.${ext}`;
        const driveUrl = await googleDrive.uploadToDrive(buffer, fileName, mimeType);
        driveUrls[label] = driveUrl;
      } catch (err: any) {
        console.error(`[CreditLimit] Failed to upload ${label} to Drive:`, err.message);
        driveUrls[label] = mediaUrl;
      }
    }

    const docSignedSO = driveUrls.docSignedSO || driveUrls.docSignedRequestLetter || '';
    const docFarmerHolding = driveUrls.docFarmerHoldingSO || driveUrls.docFarmerHoldingRequestLetter || '';

    const slackData = {
      ...report,
      requestId,
      timestamp,
      creditLimitType: session.creditLimitType,
      docSignedSO: driveUrls.docSignedSO || '',
      docFarmerHoldingSO: driveUrls.docFarmerHoldingSO || '',
      docSignedRequestLetter: driveUrls.docSignedRequestLetter || '',
      docFarmerHoldingRequestLetter: driveUrls.docFarmerHoldingRequestLetter || '',
      docLandOwnership: driveUrls.docLandOwnership || '',
      docCollateralPhoto: driveUrls.docCollateralPhoto || '',
      docCollateralCertificate: driveUrls.docCollateralCertificate || '',
    };

    const slackResult = await slack.postCreditLimitToSlack(session, slackData, (ts, channel) => {
      sessionStore.storeSlackMapping(ts, channel, {
        phoneNumber: session.phoneNumber,
        senderName: displayName,
        reportType: 'creditTopUp',
        requestId,
        farmerName: report.farmerName || '',
      });
    });

    let farmerIncomeAndBusiness = '';
    if (isLargeFarmer) {
      const parts: string[] = [];
      if (report.farmerIncomeSources) parts.push(report.farmerIncomeSources);
      if (report.businessPotential) parts.push(`Potensi Bisnis: ${report.businessPotential}`);
      farmerIncomeAndBusiness = parts.join('; ');
    }

    let collateralInfo = '';
    if (isLargeFarmer && report.collateralType) {
      collateralInfo = report.collateralType;
      if (report.creditLimitRequestAmount) {
        collateralInfo += ` - ${report.creditLimitRequestAmount}`;
      }
    }

    const sheetRow: googleSheets.CreditLimitRow = {
      timestamp,
      requestId,
      reporterName: displayName,
      reporterPhone: phoneNumber,
      fgName: report.fgName || '',
      farmerName: report.farmerName || '',
      landSizeVerified: report.landParcelSize || '',
      currentLimit: report.currentLimit || '',
      requestedTopUp: report.requestedTopUp || '',
      creditType: report.creditType || '',
      reason: report.reason || '',
      soNumber: report.soNumber || '',
      farmerIncomeAndBusiness,
      collateralInfo,
      docSignedSO: docSignedSO,
      docFarmerHolding: docFarmerHolding,
      docLandOwnership: driveUrls.docLandOwnership || '',
      docJaminan: driveUrls.docCollateralPhoto || '',
      status: 'PENDING',
      reviewedBy: '',
      reviewDate: '',
      rejectionReason: '',
      slackMessageTs: slackResult.ts || '',
    };

    console.log(`[CreditLimit] Saving slackMessageTs="${sheetRow.slackMessageTs}" to sheet for ${requestId}`);

    try {
      await googleSheets.appendRequest(sheetRow);
      console.log('[CreditLimit] Google Sheet write successful for', requestId);
    } catch (err: any) {
      console.error('[CreditLimit] Failed to write to Google Sheets:', err.message);
      console.error('[CreditLimit] Full error stack:', err.stack);
      if (err.response?.data) {
        console.error('[CreditLimit] API error details:', JSON.stringify(err.response.data));
      }
    }

    addReportLog({
      type: 'creditTopUp',
      reporter: displayName,
      phoneNumber,
      summary: `Credit Limit Top Up — ${report.farmerName || 'Unknown'} — ${report.creditType || 'Unknown'}`,
      status: 'submitted',
    });

    let successMsg = `*Credit Limit Top Up berhasil dikirim!*\n\n`;
    successMsg += `Request ID: *${requestId}*\n`;
    successMsg += `Farmer: ${report.farmerName || '—'}\n`;
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
