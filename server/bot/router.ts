import { sessionStore } from './session';
import * as wati from './services/wati';
import * as slack from './services/slack';
import { translateReport } from './services/translate';
import * as bugFlow from './flows/bugReport';
import * as adminFlow from './flows/adminRequest';
import { addReportLog } from './activityLog';
import { isWhitelisted, REJECTED_MSG } from './whitelist';

const WELCOME_MSG = `Halo! Saya Rize Report Bot.

Mau lapor apa?

1 *Bug Report* — Laporkan masalah/error di app
2 *Admin Request* — Minta bantuan admin (reset password, dll)

Balas *1* atau *2*.

_(Reply 1 for Bug Report, 2 for Admin Request.)_`;

const INVALID_TYPE_MSG = `Maaf, saya tidak mengerti. Balas dengan:

1 untuk *Bug Report*
2 untuk *Admin Request*

_(Reply 1 or 2.)_`;

const CONFIRM_ONLY_MSG = `Di langkah ini, saya hanya mengerti:

*KIRIM* — mengirim laporan
*ULANG* — mulai dari awal
Atau kirim foto/video tambahan

_(Type KIRIM to submit, ULANG to restart, or send a photo.)_`;

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

  if (['START', 'MULAI', 'HI', 'HALO', 'HELLO', 'HAI', 'MENU'].includes(upperText)) {
    sessionStore.reset(phoneNumber);
    sessionStore.create(phoneNumber, senderName);
    await wati.sendMessage(phoneNumber, WELCOME_MSG);
    return;
  }

  if (['CANCEL', 'BATAL'].includes(upperText)) {
    sessionStore.reset(phoneNumber);
    await wati.sendMessage(phoneNumber, 'Laporan dibatalkan. Ketik *START* untuk mulai lagi.\n\n_(Report cancelled. Type START to begin again.)_');
    return;
  }

  let currentSession = sessionStore.get(phoneNumber);

  if (!currentSession) {
    currentSession = sessionStore.create(phoneNumber, senderName);
    await wati.sendMessage(phoneNumber, WELCOME_MSG);
    return;
  }

  if (senderName && senderName !== phoneNumber) {
    currentSession.senderName = senderName;
  }

  if (currentSession.step === 'SELECT_TYPE') {
    if (cleanText === '1') {
      currentSession.reportType = 'bug';
      currentSession.step = 'COLLECTING';
      currentSession.data = { _stepIndex: 0 };
      await wati.sendMessage(phoneNumber, bugFlow.getFirstQuestion());
      return;
    }
    if (cleanText === '2') {
      currentSession.reportType = 'admin';
      currentSession.step = 'COLLECTING';
      currentSession.data = { _stepIndex: 0 };
      await wati.sendMessage(phoneNumber, adminFlow.getFirstQuestion());
      return;
    }
    await wati.sendMessage(phoneNumber, INVALID_TYPE_MSG);
    return;
  }

  if (currentSession.step === 'COLLECTING') {
    const flow = currentSession.reportType === 'bug' ? bugFlow : adminFlow;

    const effectiveMediaUrl =
      messageType === 'image' || messageType === 'video' || messageType === 'document'
        ? mediaUrl
        : null;

    const result = flow.processStep(currentSession, cleanText, effectiveMediaUrl);

    if (result.error) {
      await wati.sendMessage(phoneNumber, result.error);
      return;
    }

    if (result.showSummary) {
      currentSession.step = 'CONFIRMING';
      await wati.sendMessage(phoneNumber, result.summary!);
      return;
    }

    if (result.nextQuestion) {
      await wati.sendMessage(phoneNumber, result.nextQuestion);
      return;
    }
  }

  if (currentSession.step === 'CONFIRMING') {
    if (messageType === 'image' || messageType === 'video') {
      if (mediaUrl) {
        currentSession.mediaUrls.push(mediaUrl);
        await wati.sendMessage(phoneNumber, 'Foto/video ditambahkan!\n\nKetik *KIRIM* untuk mengirim laporan, atau *ULANG* untuk mulai ulang.\n\n_(Media added! Type KIRIM to submit or ULANG to restart.)_');
        return;
      }
    }

    if (upperText === 'KIRIM' || upperText === 'SUBMIT' || upperText === 'SEND') {
      await submitReport(currentSession);
      return;
    }

    if (upperText === 'ULANG' || upperText === 'RESTART' || upperText === 'EDIT') {
      currentSession.step = 'COLLECTING';
      currentSession.data = { _stepIndex: 0 };
      currentSession.mediaUrls = [];
      const flow = currentSession.reportType === 'bug' ? bugFlow : adminFlow;
      await wati.sendMessage(phoneNumber, 'Mulai ulang!\n\n' + flow.getFirstQuestion());
      return;
    }

    await wati.sendMessage(phoneNumber, CONFIRM_ONLY_MSG);
    return;
  }
}

async function submitReport(currentSession: ReturnType<typeof sessionStore.create>): Promise<void> {
  const phoneNumber = currentSession.phoneNumber;

  try {
    await wati.sendMessage(phoneNumber, 'Sedang memproses laporan...\n\n_(Processing your report...)_');

    let translatedData: Record<string, any>;
    try {
      translatedData = await translateReport(currentSession.data, currentSession.reportType!);
    } catch (err: any) {
      console.error('[Router] Translation failed, using original:', err.message);
      translatedData = { ...currentSession.data };
    }

    await slack.postToSlack(currentSession, translatedData, (ts, channel) => {
      sessionStore.storeSlackMapping(ts, channel, {
        phoneNumber: currentSession.phoneNumber,
        senderName: currentSession.senderName,
        reportType: currentSession.reportType!,
      });
    });

    const name = currentSession.senderName || phoneNumber;
    const typeLabel = currentSession.reportType === 'bug' ? 'Bug Report' : 'Admin Request';

    addReportLog({
      type: currentSession.reportType!,
      reporter: name,
      phoneNumber,
      summary: currentSession.reportType === 'bug'
        ? currentSession.data.whatHappened
        : currentSession.data.requestDescription,
      status: 'submitted',
    });

    await wati.sendMessage(
      phoneNumber,
      `*${typeLabel} berhasil dikirim!*\n\nTim sudah dinotifikasi. Terima kasih, ${name}!\n\nKetik *START* untuk laporan baru.\n\n_(${typeLabel} submitted successfully! The team has been notified. Type START for a new report.)_`
    );

    sessionStore.reset(phoneNumber);
  } catch (err: any) {
    console.error('[Router] Submit failed:', err.message);
    await wati.sendMessage(
      phoneNumber,
      'Maaf, gagal mengirim laporan. Silakan coba lagi.\nKetik *KIRIM* untuk coba lagi, atau *ULANG* untuk mulai ulang.\n\n_(Failed to submit. Type KIRIM to retry, or ULANG to restart.)_'
    );
  }
}
