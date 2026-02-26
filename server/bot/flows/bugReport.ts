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
    id: 'whatHappened',
    question:
      '*Bug Report*\n\nApa yang terjadi? Jelaskan masalahnya secara detail.\n\n_(What happened? Describe the bug in detail.)_',
    required: true,
    minLength: 5,
  },
  {
    id: 'stepsToReproduce',
    question:
      'Langkah untuk mereproduksi masalah?\n(contoh: 1. Buka task, 2. Klik submit)\n\nKetik *SKIP* jika tidak tahu.\n\n_(Steps to reproduce? Type SKIP if unknown.)_',
    required: false,
    minLength: 3,
  },
  {
    id: 'platform',
    question:
      'Platform apa?\n\n1 Android\n2 iOS\n3 Web\n\nBalas 1, 2, atau 3.',
    required: true,
    minLength: 1,
    type: 'choice',
    choices: { '1': 'Android', '2': 'iOS', '3': 'Web' },
  },
  {
    id: 'appVersion',
    question:
      'Versi app berapa?\n(contoh: 1.19.1, 2.0.3)\n\nKetik *SKIP* jika tidak tahu.\n\n_(What app version? e.g. 1.19.1)_',
    required: false,
    minLength: 1,
  },
  {
    id: 'accountInfo',
    question:
      'Email atau username akun yang dipakai?\n(contoh: budi@rize.farm)\n\n_(Which account email or username?)_',
    required: true,
    minLength: 5,
  },
  {
    id: 'relatedInfo',
    question:
      'Info terkait:\n- Task Name?\n- PG Name?\n- Farmer Name?\n- Season?\n\nTulis semua yang relevan, atau ketik *SKIP*.\n\n_(Related info: Task/PG/Farmer/Season. Type SKIP if none.)_',
    required: false,
    minLength: 2,
  },
  {
    id: 'screenshot',
    question:
      'Kirim screenshot atau video sekarang.\nKetik *SKIP* jika tidak ada.\n\n_(Send screenshot/video, or type SKIP.)_',
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

  return `*Ringkasan Bug Report:*

*Masalah:* ${d.whatHappened || '—'}
*Langkah reproduksi:* ${d.stepsToReproduce || 'Dilewati'}
*Platform:* ${d.platform || '—'}
*Versi app:* ${d.appVersion || 'Tidak tahu'}
*Akun:* ${d.accountInfo || '—'}
*Info terkait:* ${d.relatedInfo || 'Dilewati'}
*Screenshot:* ${hasMedia ? session.mediaUrls.length + ' file' : 'Tidak ada'}

Ketik *KIRIM* untuk mengirim laporan.
Ketik *ULANG* untuk mulai dari awal.

_(Type KIRIM to submit, or ULANG to restart.)_`;
}
