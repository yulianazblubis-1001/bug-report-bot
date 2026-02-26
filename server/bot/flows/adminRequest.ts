import type { BotSession } from '../session';
import { isGarbageInput, validateTextInput, REJECTION_MSG } from './validation';

interface StepDef {
  id: string;
  question: string;
  required: boolean;
  minLength: number;
  type?: 'choice' | 'media';
  choices?: Record<string, string>;
}

const STEPS: StepDef[] = [
  {
    id: 'requestDescription',
    question:
      '*Admin Request*\n\nApa yang kamu butuhkan? Jelaskan permintaannya.\n\n_(What do you need? Describe the admin action required.)_',
    required: true,
    minLength: 5,
  },
  {
    id: 'accountAffected',
    question:
      'Akun siapa yang terdampak?\n(email, nama PG, atau nama Farmer)\n\n_(Which account is affected? Email or PG/Farmer name.)_',
    required: true,
    minLength: 5,
  },
  {
    id: 'urgency',
    question:
      'Seberapa urgent?\n\n1 Rendah (Low)\n2 Sedang (Medium)\n3 Tinggi (High)\n\nBalas 1, 2, atau 3.',
    required: true,
    minLength: 1,
    type: 'choice',
    choices: { '1': '1', '2': '2', '3': '3' },
  },
  {
    id: 'additionalContext',
    question:
      'Ada info tambahan?\n(error message, nomor invoice, langkah reproduksi, dll)\n\nKetik *SKIP* jika tidak ada.\n\n_(Any additional context? Type SKIP if none.)_',
    required: false,
    minLength: 3,
  },
  {
    id: 'screenshot',
    question:
      'Kirim screenshot jika ada.\nKetik *SKIP* jika tidak ada.\n\n_(Send screenshot if available, or type SKIP.)_',
    required: false,
    minLength: 0,
    type: 'media',
  },
];

export function getFirstQuestion(): string {
  return STEPS[0].question;
}

export function processStep(
  session: BotSession,
  text: string,
  mediaUrl: string | null
): { nextQuestion?: string; isDone?: boolean; showSummary?: boolean; summary?: string; error?: string } {
  const stepIndex = session.data._stepIndex || 0;

  if (stepIndex >= STEPS.length) {
    return { isDone: true };
  }

  const step = STEPS[stepIndex];

  if (!step.required && text && text.trim().toUpperCase() === 'SKIP') {
    session.data[step.id] = null;
    session.data._stepIndex = stepIndex + 1;
    return getNextResponse(session);
  }

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
    return { error: REJECTION_MSG };
  }

  if (step.type === 'choice') {
    const choice = text ? text.trim() : '';
    if (step.choices && step.choices[choice]) {
      session.data[step.id] = step.choices[choice];
      session.data._stepIndex = stepIndex + 1;
      return getNextResponse(session);
    }
    return { error: REJECTION_MSG };
  }

  const validationError = validateTextInput(text, step.minLength);
  if (validationError) {
    return { error: validationError };
  }

  session.data[step.id] = text.trim();
  session.data._stepIndex = stepIndex + 1;

  return getNextResponse(session);
}

function getNextResponse(session: BotSession) {
  const stepIndex = session.data._stepIndex || 0;

  if (stepIndex >= STEPS.length) {
    return {
      showSummary: true,
      summary: buildSummary(session),
    };
  }

  return {
    nextQuestion: STEPS[stepIndex].question,
  };
}

export function buildSummary(session: BotSession): string {
  const d = session.data;
  const hasMedia = session.mediaUrls.length > 0;
  const urgencyMap: Record<string, string> = { '1': 'Rendah', '2': 'Sedang', '3': 'Tinggi' };

  return `*Ringkasan Admin Request:*

*Permintaan:* ${d.requestDescription || '—'}
*Akun terdampak:* ${d.accountAffected || '—'}
*Urgency:* ${urgencyMap[d.urgency] || d.urgency || '—'}
*Info tambahan:* ${d.additionalContext || 'Dilewati'}
*Screenshot:* ${hasMedia ? session.mediaUrls.length + ' file' : 'Tidak ada'}

Ketik *KIRIM* untuk mengirim laporan.
Ketik *ULANG* untuk mulai dari awal.

_(Type KIRIM to submit, or ULANG to restart.)_`;
}
