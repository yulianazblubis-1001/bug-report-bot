/**
 * Message Router — main orchestration logic
 * 
 * Handles incoming WATI webhook messages and routes them
 * through the correct flow based on session state.
 * 
 * KEY PRINCIPLE: No AI during data collection. 
 * AI (Claude) is only used AFTER all data is collected, for translation.
 */

const session = require('./session');
const wati = require('./services/wati');
const slack = require('./services/slack');
const { translateReport } = require('./services/translate');
const bugFlow = require('./flows/bugReport');
const adminFlow = require('./flows/adminRequest');

const WELCOME_MSG = `👋 Halo! Saya Rize Report Bot.

Mau lapor apa?

1️⃣ *Bug Report* — Laporkan masalah/error di app
2️⃣ *Admin Request* — Minta bantuan admin (reset password, dll)

Balas *1* atau *2*.

_(Reply 1 for Bug Report, 2 for Admin Request.)_`;

const INVALID_TYPE_MSG = `⚠️ Maaf, saya tidak mengerti. Balas dengan:

1️⃣ untuk *Bug Report*
2️⃣ untuk *Admin Request*

_(Reply 1 or 2.)_`;

const CONFIRM_ONLY_MSG = `⚠️ Di langkah ini, saya hanya mengerti:

✅ *KIRIM* — mengirim laporan
🔄 *ULANG* — mulai dari awal
📸 Atau kirim foto/video tambahan

_(Type KIRIM to submit, ULANG to restart, or send a photo.)_`;

/**
 * Main handler for incoming WATI webhook messages
 */
async function handleMessage(phoneNumber, senderName, text, messageType, mediaUrl) {
    const cleanText = text ? text.trim() : '';
    const upperText = cleanText.toUpperCase();

    // Global commands — always work regardless of state
    if (['START', 'MULAI', 'HI', 'HALO', 'HELLO', 'HAI', 'MENU'].includes(upperText)) {
        session.reset(phoneNumber);
        session.create(phoneNumber, senderName);
        await wati.sendMessage(phoneNumber, WELCOME_MSG);
        return;
    }

    if (['CANCEL', 'BATAL'].includes(upperText)) {
        session.reset(phoneNumber);
        await wati.sendMessage(phoneNumber, '❌ Laporan dibatalkan. Ketik *START* untuk mulai lagi.\n\n_(Report cancelled. Type START to begin again.)_');
        return;
    }

    // Get or create session
    let currentSession = session.get(phoneNumber);

    if (!currentSession) {
        currentSession = session.create(phoneNumber, senderName);
        await wati.sendMessage(phoneNumber, WELCOME_MSG);
        return;
    }

    // Update sender name if we got a better one
    if (senderName && senderName !== phoneNumber) {
        currentSession.senderName = senderName;
    }

    // === STATE: SELECT REPORT TYPE ===
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
        // Invalid selection
        await wati.sendMessage(phoneNumber, INVALID_TYPE_MSG);
        return;
    }

    // === STATE: COLLECTING DATA (step-by-step) ===
    if (currentSession.step === 'COLLECTING') {
        const flow = currentSession.reportType === 'bug' ? bugFlow : adminFlow;

        // Handle media messages (images/videos) — pass the URL to the flow
        const effectiveMediaUrl = (messageType === 'image' || messageType === 'video' || messageType === 'document')
            ? mediaUrl
            : null;

        const result = flow.processStep(currentSession, cleanText, effectiveMediaUrl);

        if (result.error) {
            await wati.sendMessage(phoneNumber, result.error);
            return;
        }

        if (result.showSummary) {
            currentSession.step = 'CONFIRMING';
            await wati.sendMessage(phoneNumber, result.summary);
            return;
        }

        if (result.nextQuestion) {
            await wati.sendMessage(phoneNumber, result.nextQuestion);
            return;
        }
    }

    // === STATE: CONFIRMING (summary shown, waiting for KIRIM/ULANG) ===
    if (currentSession.step === 'CONFIRMING') {
        // Accept additional media at this stage
        if (messageType === 'image' || messageType === 'video') {
            if (mediaUrl) {
                currentSession.mediaUrls.push(mediaUrl);
                await wati.sendMessage(phoneNumber, '📎 Foto/video ditambahkan!\n\nKetik *KIRIM* untuk mengirim laporan, atau *ULANG* untuk mulai ulang.\n\n_(Media added! Type KIRIM to submit or ULANG to restart.)_');
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
            await wati.sendMessage(phoneNumber, '🔄 Mulai ulang!\n\n' + flow.getFirstQuestion());
            return;
        }

        // Anything else at this stage
        await wati.sendMessage(phoneNumber, CONFIRM_ONLY_MSG);
        return;
    }
}

/**
 * Submit the report: translate → post to Slack → notify user
 */
async function submitReport(currentSession) {
    const phoneNumber = currentSession.phoneNumber;

    try {
        // Tell user we're processing
        await wati.sendMessage(phoneNumber, '⏳ Sedang memproses laporan...\n\n_(Processing your report...)_');

        // Step 1: Translate text fields
        let translatedData;
        try {
            translatedData = await translateReport(currentSession.data, currentSession.reportType);
        } catch (err) {
            console.error('[Router] Translation failed, using original:', err.message);
            translatedData = { ...currentSession.data };
        }

        // Step 2: Post to Slack
        await slack.postToSlack(currentSession, translatedData);

        // Step 3: Success message
        const name = currentSession.senderName || phoneNumber;
        const typeLabel = currentSession.reportType === 'bug' ? 'Bug Report' : 'Admin Request';

        await wati.sendMessage(phoneNumber,
            `✅ *${typeLabel} berhasil dikirim!*\n\nTim sudah dinotifikasi. Terima kasih, ${name}! 🙏\n\nKetik *START* untuk laporan baru.\n\n_(${typeLabel} submitted successfully! The team has been notified. Type START for a new report.)_`
        );

        // Clean up session
        session.reset(phoneNumber);

    } catch (err) {
        console.error('[Router] Submit failed:', err.message);
        await wati.sendMessage(phoneNumber,
            '❌ Maaf, gagal mengirim laporan. Silakan coba lagi.\nKetik *KIRIM* untuk coba lagi, atau *ULANG* untuk mulai ulang.\n\n_(Failed to submit. Type KIRIM to retry, or ULANG to restart.)_'
        );
    }
}

module.exports = { handleMessage };
