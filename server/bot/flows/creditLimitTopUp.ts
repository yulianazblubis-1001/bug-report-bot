import type { BotSession } from '../session';
import { validateTextInput, REJECTION_MSG } from './validation';

interface StepDef {
  id: string;
  question: string;
  required: boolean;
  minLength: number;
  type?: 'choice' | 'media';
  choices?: Record<string, string>;
}

const BASE_STEPS: StepDef[] = [
  {
    id: 'fgName',
    question: 'Siapa nama FG?\n\n_(What is the FG name?)_',
    required: true,
    minLength: 2,
  },
  {
    id: 'farmerName',
    question: 'Siapa nama Farmer yang butuh top up credit limit?\n\n_(Which farmer needs a credit limit top-up?)_',
    required: true,
    minLength: 2,
  },
  {
    id: 'landParcelSize',
    question: 'Berapa total luas lahan terverifikasi (Ha)?\n(contoh: 1.5 atau 3.2)\n\n_(What is the total verified land parcel size in hectares?)_',
    required: true,
    minLength: 1,
  },
  {
    id: 'currentLimit',
    question: 'Berapa credit limit saat ini?\n(contoh: IDR 14jt)\n\n_(What is the current credit limit?)_',
    required: true,
    minLength: 2,
  },
  {
    id: 'requestedTopUp',
    question: 'Berapa jumlah top up yang dibutuhkan?\n(contoh: tambah IDR 5jt, atau total jadi IDR 19jt)\n\n_(How much top-up is needed?)_',
    required: true,
    minLength: 2,
  },
  {
    id: 'creditType',
    question: 'Jenis credit limit apa?\n\n1 Agri Input\n2 Mechanization\n\nBalas 1 atau 2.\n\n_(Credit type? Reply 1 or 2.)_',
    required: true,
    minLength: 1,
    type: 'choice',
    choices: { '1': 'Agri Input', '2': 'Mechanization' },
  },
  {
    id: 'reason',
    question: 'Jelaskan alasan mengapa top up dibutuhkan. Harus detail dan jelas.\n\n_(Explain the reason for the top-up request. Must be detailed.)_',
    required: true,
    minLength: 10,
  },
];

function buildRemainingSteps(creditType: string, landParcelSize: number): StepDef[] {
  const steps: StepDef[] = [];
  const isAgriInput = creditType === 'Agri Input';
  const isLargeFarmer = landParcelSize > 2.5;

  if (isAgriInput) {
    steps.push({
      id: 'soNumber',
      question: 'Berapa nomor Sales Order (SO)?\n\n_(What is the Sales Order number?)_',
      required: true,
      minLength: 2,
    });
    steps.push({
      id: 'docSignedSO',
      question: 'Kirim foto SO yang sudah ditandatangani Farmer. WAJIB.\n\n_(Send a photo of the SO signed by the farmer. MANDATORY.)_',
      required: true,
      minLength: 0,
      type: 'media',
    });
    steps.push({
      id: 'docFarmerHolding',
      question: 'Kirim foto Farmer sedang memegang SO yang sudah ditandatangani. WAJIB.\n\n_(Send a photo of the farmer holding the signed SO. MANDATORY.)_',
      required: true,
      minLength: 0,
      type: 'media',
    });
  } else {
    steps.push({
      id: 'docSignedSO',
      question: 'Kirim foto Surat Permohonan yang sudah ditandatangani Farmer. WAJIB.\n\n_(Send a photo of the signed Request Letter. MANDATORY.)_',
      required: true,
      minLength: 0,
      type: 'media',
    });
    steps.push({
      id: 'docFarmerHolding',
      question: 'Kirim foto Farmer sedang memegang Surat Permohonan yang sudah ditandatangani. WAJIB.\n\n_(Send a photo of the farmer holding the signed Request Letter. MANDATORY.)_',
      required: true,
      minLength: 0,
      type: 'media',
    });
  }

  if (isLargeFarmer) {
    steps.push({
      id: 'docLandOwnership',
      question: '⚠️ Lahan > 2.5 Ha — termasuk kategori Large Farmer.\nKirim bukti kepemilikan atau sewa lahan (sertifikat/surat sewa). WAJIB.\n\n_(Land > 2.5 Ha — Large Farmer category. Send proof of land ownership. MANDATORY.)_',
      required: true,
      minLength: 0,
      type: 'media',
    });
    steps.push({
      id: 'docJaminan',
      question: 'Kirim Dokumen Jaminan sebagai syarat perpanjangan limit kredit. WAJIB.\n\n_(Send the Guarantee Document as a requirement for credit limit extension. MANDATORY.)_',
      required: true,
      minLength: 0,
      type: 'media',
    });
  }

  return steps;
}

function getAllSteps(session: BotSession): StepDef[] {
  const creditType = session.data.creditType;
  const landParcelSize = parseFloat(session.data.landParcelSize) || 0;

  if (!creditType) {
    return BASE_STEPS;
  }

  return [...BASE_STEPS, ...buildRemainingSteps(creditType, landParcelSize)];
}

export function getFirstQuestion(): string {
  return BASE_STEPS[0].question;
}

export function processStep(
  session: BotSession,
  text: string,
  mediaUrl: string | null
): { nextQuestion?: string; isDone?: boolean; showSummary?: boolean; summary?: string; error?: string } {
  const stepIndex = session.data._stepIndex || 0;
  const steps = getAllSteps(session);

  if (stepIndex >= steps.length) {
    return { isDone: true };
  }

  const step = steps[stepIndex];

  if (step.type === 'media') {
    if (mediaUrl) {
      session.mediaUrls.push(mediaUrl);
      session.data[step.id] = mediaUrl;
      session.data._stepIndex = stepIndex + 1;
      return getNextResponse(session);
    }
    return { error: '⚠️ Langkah ini membutuhkan foto/dokumen. Tolong kirim file ya.\n\n_(This step requires a photo/document. Please send a file.)_' };
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

function getNextResponse(session: BotSession): { nextQuestion?: string; showSummary?: boolean; summary?: string } {
  const stepIndex = session.data._stepIndex || 0;
  const steps = getAllSteps(session);

  if (stepIndex >= steps.length) {
    return {
      showSummary: true,
      summary: buildSummary(session),
    };
  }

  return {
    nextQuestion: steps[stepIndex].question,
  };
}

export function buildSummary(session: BotSession): string {
  const d = session.data;
  const isAgriInput = d.creditType === 'Agri Input';
  const landSize = parseFloat(d.landParcelSize) || 0;
  const isLargeFarmer = landSize > 2.5;

  let docCount = 0;
  if (d.docSignedSO) docCount++;
  if (d.docFarmerHolding) docCount++;
  if (d.docLandOwnership) docCount++;
  if (d.docJaminan) docCount++;

  let summary = `*Ringkasan Credit Limit Top Up:*\n\n`;
  summary += `*FG:* ${d.fgName || '—'}\n`;
  summary += `*Farmer:* ${d.farmerName || '—'}\n`;
  summary += `*Luas Lahan:* ${d.landParcelSize || '—'} Ha`;
  if (isLargeFarmer) summary += ` ⚠️ LARGE FARMER`;
  summary += `\n`;
  summary += `*Credit Limit Sekarang:* ${d.currentLimit || '—'}\n`;
  summary += `*Top Up:* ${d.requestedTopUp || '—'}\n`;
  summary += `*Jenis Credit:* ${d.creditType || '—'}\n`;
  summary += `*Alasan:* ${d.reason || '—'}\n`;

  if (isAgriInput && d.soNumber) {
    summary += `*Nomor SO:* ${d.soNumber}\n`;
  }

  summary += `\n*Dokumen:* ${docCount} file terlampir`;

  if (isAgriInput) {
    summary += `\n  - SO ditandatangani ${d.docSignedSO ? '✅' : '❌'}`;
    summary += `\n  - Farmer memegang SO ${d.docFarmerHolding ? '✅' : '❌'}`;
  } else {
    summary += `\n  - Surat Permohonan ditandatangani ${d.docSignedSO ? '✅' : '❌'}`;
    summary += `\n  - Farmer memegang Surat Permohonan ${d.docFarmerHolding ? '✅' : '❌'}`;
  }

  if (isLargeFarmer) {
    summary += `\n  - Bukti kepemilikan lahan ${d.docLandOwnership ? '✅' : '❌'}`;
    summary += `\n  - Dokumen Jaminan ${d.docJaminan ? '✅' : '❌'}`;
  }

  summary += `\n\nKetik *KIRIM* untuk mengirim permintaan.`;
  summary += `\nKetik *ULANG* untuk mulai dari awal.`;
  summary += `\n\n_(Type KIRIM to submit, or ULANG to restart.)_`;

  return summary;
}
