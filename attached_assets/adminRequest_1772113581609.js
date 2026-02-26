/**
 * Admin Request Flow — step-by-step state machine
 * 
 * Same rules as bugReport.js:
 * - ONE question at a time
 * - Store raw answers (NO AI during collection)
 * - Validate inputs
 */

const STEPS = [
    {
        id: 'requestDescription',
        question:
            '🛠️ *Admin Request*\n\nApa yang kamu butuhkan? Jelaskan permintaannya.\n\n_(What do you need? Describe the admin action required.)_',
        required: true,
        minLength: 5,
        errorMsg: '⚠️ Tolong jelaskan permintaanmu dengan lebih detail (minimal beberapa kata).\n\n_Please describe what you need in more detail._',
    },
    {
        id: 'accountAffected',
        question:
            '👤 Akun siapa yang terdampak?\n(email, nama PG, atau nama Farmer)\n\n_(Which account is affected? Email or PG/Farmer name.)_',
        required: true,
        minLength: 2,
        errorMsg: '⚠️ Tolong berikan email atau nama akun yang terdampak.\n\n_Please provide the affected account email or name._',
    },
    {
        id: 'urgency',
        question:
            '⚡ Seberapa urgent?\n\n1️⃣ 🟢 Rendah (Low)\n2️⃣ 🟡 Sedang (Medium)\n3️⃣ 🔴 Tinggi (High)\n\nBalas 1, 2, atau 3.',
        required: true,
        type: 'choice',
        choices: { '1': '1', '2': '2', '3': '3' },
        errorMsg: '⚠️ Balas dengan *1* (Rendah), *2* (Sedang), atau *3* (Tinggi).',
    },
    {
        id: 'additionalContext',
        question:
            '💬 Ada info tambahan?\n(error message, nomor invoice, langkah reproduksi, dll)\n\nKetik *SKIP* jika tidak ada.\n\n_(Any additional context? Type SKIP if none.)_',
        required: false,
        minLength: 3,
        errorMsg: '⚠️ Tulis info tambahan, atau ketik *SKIP*.\n\n_Provide additional info, or type SKIP._',
    },
    {
        id: 'screenshot',
        question:
            '📸 Kirim screenshot jika ada.\nKetik *SKIP* jika tidak ada.\n\n_(Send screenshot if available, or type SKIP.)_',
        required: false,
        type: 'media',
        errorMsg: '⚠️ Kirim foto/video, atau ketik *SKIP*.\n\n_Send a photo/video, or type SKIP._',
    },
];

/**
 * Check if input is garbage (just symbols, single chars, etc.)
 */
function isGarbageInput(text) {
    if (!text) return true;
    const cleaned = text.trim();
    if (cleaned.length === 0) return true;
    if (cleaned.length === 1 && !/[0-9]/.test(cleaned)) return true;
    if (/^[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+$/.test(cleaned)) return true;
    return false;
}

function getFirstQuestion() {
    return STEPS[0].question;
}

/**
 * Process a user's reply at the current step
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
        return { error: step.errorMsg };
    }

    // Handle choice step (urgency)
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

    if (text.trim().length < (step.minLength || 1)) {
        return { error: step.errorMsg };
    }

    session.data[step.id] = text.trim();
    session.data._stepIndex = stepIndex + 1;

    return getNextResponse(session);
}

function getNextResponse(session) {
    const stepIndex = session.data._stepIndex || 0;

    if (stepIndex >= STEPS.length) {
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

function buildSummary(session) {
    const d = session.data;
    const hasMedia = session.mediaUrls.length > 0;
    const urgencyMap = { '1': '🟢 Rendah', '2': '🟡 Sedang', '3': '🔴 Tinggi' };

    return `📋 *Ringkasan Admin Request:*
━━━━━━━━━━━━━━━━━━━━

📝 *Permintaan:* ${d.requestDescription || '—'}
👤 *Akun terdampak:* ${d.accountAffected || '—'}
⚡ *Urgency:* ${urgencyMap[d.urgency] || d.urgency || '—'}
💬 *Info tambahan:* ${d.additionalContext || 'Dilewati'}
📸 *Screenshot:* ${hasMedia ? '✅ ' + session.mediaUrls.length + ' file' : 'Tidak ada'}

━━━━━━━━━━━━━━━━━━━━
Ketik *KIRIM* untuk mengirim laporan.
Ketik *ULANG* untuk mulai dari awal.

_(Type KIRIM to submit, or ULANG to restart.)_`;
}

module.exports = {
    getFirstQuestion,
    processStep,
    buildSummary,
};
