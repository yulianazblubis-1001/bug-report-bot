/**
 * Bug Report Flow — step-by-step state machine
 * 
 * RULES:
 * - ONE question at a time
 * - Store raw answers as-is (NO AI interpretation during collection)
 * - Validate required fields (reject garbage like "-" or single chars)
 * - Translation only happens AFTER all fields are collected
 */

const STEPS = [
    {
        id: 'whatHappened',
        question:
            '🐛 *Bug Report*\n\nApa yang terjadi? Jelaskan masalahnya secara detail.\n\n_(What happened? Describe the bug in detail.)_',
        required: true,
        minLength: 5,
        errorMsg: '⚠️ Tolong jelaskan masalahnya dengan lebih detail (minimal beberapa kata).\n\n_Please describe the bug in more detail (at least a few words)._',
    },
    {
        id: 'stepsToReproduce',
        question:
            '🔁 Langkah untuk mereproduksi masalah?\n(contoh: 1. Buka task, 2. Klik submit)\n\nKetik *SKIP* jika tidak tahu.\n\n_(Steps to reproduce? Type SKIP if unknown.)_',
        required: false,
        minLength: 3,
        errorMsg: '⚠️ Jelaskan langkahnya, atau ketik *SKIP*.\n\n_Describe the steps, or type SKIP._',
    },
    {
        id: 'platform',
        question:
            '📱 Platform apa?\n\n1️⃣ Android\n2️⃣ iOS\n3️⃣ Web\n\nBalas 1, 2, atau 3.',
        required: true,
        type: 'choice',
        choices: { '1': 'Android', '2': 'iOS', '3': 'Web' },
        errorMsg: '⚠️ Balas dengan *1* (Android), *2* (iOS), atau *3* (Web).',
    },
    {
        id: 'appVersion',
        question:
            '📲 Versi app berapa?\n(contoh: 1.19.1, 2.0.3)\n\nKetik *SKIP* jika tidak tahu.\n\n_(What app version? e.g. 1.19.1)_',
        required: false,
        minLength: 1,
        errorMsg: '⚠️ Ketik versi app (contoh: 1.19.1), atau ketik *SKIP*.',
    },
    {
        id: 'accountInfo',
        question:
            '📧 Email atau username akun yang dipakai?\n(contoh: budi@rize.farm)\n\n_(Which account email or username?)_',
        required: true,
        minLength: 3,
        errorMsg: '⚠️ Tolong berikan email atau username akun. Minimal 3 karakter.\n\n_Please provide account email or username._',
    },
    {
        id: 'relatedInfo',
        question:
            '🔗 Info terkait:\n• Task Name?\n• PG Name?\n• Farmer Name?\n• Season?\n\nTulis semua yang relevan, atau ketik *SKIP*.\n\n_(Related info: Task/PG/Farmer/Season. Type SKIP if none.)_',
        required: false,
        minLength: 2,
        errorMsg: '⚠️ Tulis info terkait, atau ketik *SKIP*.\n\n_Provide related info, or type SKIP._',
    },
    {
        id: 'screenshot',
        question:
            '📸 Kirim screenshot atau video sekarang.\nKetik *SKIP* jika tidak ada.\n\n_(Send screenshot/video, or type SKIP.)_',
        required: false,
        type: 'media',
        errorMsg: '⚠️ Kirim foto/video, atau ketik *SKIP*.\n\n_Send a photo/video, or type SKIP._',
    },
];

/**
 * Get the current step definition for a session
 */
function getCurrentStep(session) {
    const stepIndex = session.data._stepIndex || 0;
    if (stepIndex >= STEPS.length) return null;
    return STEPS[stepIndex];
}

/**
 * Get the total number of steps
 */
function getTotalSteps() {
    return STEPS.length;
}

/**
 * Get the first question to ask
 */
function getFirstQuestion() {
    return STEPS[0].question;
}

/**
 * Check if input is garbage (just symbols, single chars, etc.)
 */
function isGarbageInput(text) {
    if (!text) return true;
    const cleaned = text.trim();
    if (cleaned.length === 0) return true;
    // Single character that's not a number
    if (cleaned.length === 1 && !/[0-9]/.test(cleaned)) return true;
    // Only symbols/punctuation
    if (/^[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+$/.test(cleaned)) return true;
    return false;
}

/**
 * Process a user's reply at the current step
 * Returns { nextQuestion, isDone, error, summary }
 */
function processStep(session, text, mediaUrl) {
    const stepIndex = session.data._stepIndex || 0;

    if (stepIndex >= STEPS.length) {
        return { isDone: true };
    }

    const step = STEPS[stepIndex];

    // Handle SKIP for optional fields
    if (!step.required && text && text.trim().toUpperCase() === 'SKIP') {
        session.data[step.id] = null;
        session.data._stepIndex = stepIndex + 1;
        return getNextResponse(session);
    }

    // Handle media step
    if (step.type === 'media') {
        if (mediaUrl) {
            session.mediaUrls.push(mediaUrl);
            session.data[step.id] = 'attached';
            session.data._stepIndex = stepIndex + 1;
            return getNextResponse(session);
        }
        if (text && text.trim().toUpperCase() === 'SKIP') {
            session.data[step.id] = null;
            session.data._stepIndex = stepIndex + 1;
            return getNextResponse(session);
        }
        // If they send text at the media step (not SKIP), could be an extra image
        if (text && !isGarbageInput(text) && text.trim().toUpperCase() !== 'SKIP') {
            return { error: step.errorMsg };
        }
        return { error: step.errorMsg };
    }

    // Handle choice step (platform)
    if (step.type === 'choice') {
        const choice = text ? text.trim() : '';
        if (step.choices[choice]) {
            session.data[step.id] = step.choices[choice];
            session.data._stepIndex = stepIndex + 1;
            return getNextResponse(session);
        }
        return { error: step.errorMsg };
    }

    // Handle text steps
    if (isGarbageInput(text)) {
        return { error: step.errorMsg };
    }

    if (step.required && text.trim().length < (step.minLength || 1)) {
        return { error: step.errorMsg };
    }

    if (!step.required && text.trim().length < (step.minLength || 1)) {
        return { error: step.errorMsg };
    }

    // Store the raw answer
    session.data[step.id] = text.trim();
    session.data._stepIndex = stepIndex + 1;

    return getNextResponse(session);
}

/**
 * Get the next question or summary
 */
function getNextResponse(session) {
    const stepIndex = session.data._stepIndex || 0;

    if (stepIndex >= STEPS.length) {
        // All steps done — show summary for confirmation
        return {
            isDone: false,
            showSummary: true,
            summary: buildSummary(session),
        };
    }

    return {
        isDone: false,
        nextQuestion: STEPS[stepIndex].question,
    };
}

/**
 * Build a summary message for the user to confirm
 */
function buildSummary(session) {
    const d = session.data;
    const hasMedia = session.mediaUrls.length > 0;

    return `📋 *Ringkasan Bug Report:*
━━━━━━━━━━━━━━━━━━━━

📝 *Masalah:* ${d.whatHappened || '—'}
🔁 *Langkah reproduksi:* ${d.stepsToReproduce || 'Dilewati'}
📱 *Platform:* ${d.platform || '—'}
📲 *Versi app:* ${d.appVersion || 'Tidak tahu'}
📧 *Akun:* ${d.accountInfo || '—'}
🔗 *Info terkait:* ${d.relatedInfo || 'Dilewati'}
📸 *Screenshot:* ${hasMedia ? '✅ ' + session.mediaUrls.length + ' file' : 'Tidak ada'}

━━━━━━━━━━━━━━━━━━━━
Ketik *KIRIM* untuk mengirim laporan.
Ketik *ULANG* untuk mulai dari awal.

_(Type KIRIM to submit, or ULANG to restart.)_`;
}

module.exports = {
    getCurrentStep,
    getTotalSteps,
    getFirstQuestion,
    processStep,
    buildSummary,
};
