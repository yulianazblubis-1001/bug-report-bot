import Anthropic from '@anthropic-ai/sdk';
import { findRelevantContext } from './farmer-knowledge';
import { logQa } from '../farmer-kb-db';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const FALLBACK_MSG = `Maaf, saya belum punya informasi soal itu. Coba hubungi Territory Manager atau agronomis kamu ya.

_(Sorry, I don't have information on that yet. Please contact your Territory Manager or agronomist.)_`;

const TECH_ERROR_MSG = `Maaf, ada gangguan teknis sementara. Coba kirim ulang pertanyaan kamu.

_(Sorry, temporary technical issue. Please resend your question.)_`;

export interface FarmerTurn {
  role: 'user' | 'assistant';
  text: string;
}

export async function answerFarmerQuestion(
  phoneNumber: string,
  senderName: string,
  question: string,
  history: FarmerTurn[]
): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[FarmerQA] No ANTHROPIC_API_KEY set');
    return FALLBACK_MSG;
  }

  let context: Awaited<ReturnType<typeof findRelevantContext>> = [];
  try {
    context = await findRelevantContext(question);
  } catch (err: any) {
    console.error('[FarmerQA] Retrieval failed:', err.message);
    return TECH_ERROR_MSG;
  }

  if (context.length === 0) {
    await logQa({ phoneNumber, senderName, question, answer: FALLBACK_MSG, matchedSources: [] });
    return FALLBACK_MSG;
  }

  const contextText = context.map((c, i) => `[${i + 1}] (${c.source}) ${c.text}`).join('\n');

  const systemPrompt = `You are a friendly agricultural assistant for Rize.farm, helping Indonesian farmers over WhatsApp.

Answer the farmer's question using ONLY the reference data below. Be concise (2-5 sentences), practical, and specific (include exact numbers/dosages/names from the data when relevant).

Reply in casual, friendly Indonesian first, then a "---" separator, then a short English translation. Always bilingual, no exceptions.

If the reference data does not actually answer the question, say so honestly — do NOT guess or invent numbers, dosages, or recommendations — and suggest they contact their Territory Manager or agronomist instead.

REFERENCE DATA:
${contextText}`;

  const messages = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.text })),
    { role: 'user' as const, content: question },
  ];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 700,
      system: systemPrompt,
      messages,
    });

    const answer = (response.content[0] as any).text.trim();
    await logQa({
      phoneNumber,
      senderName,
      question,
      answer,
      matchedSources: Array.from(new Set(context.map((c) => c.source))),
    });
    return answer;
  } catch (err: any) {
    console.error('[FarmerQA] Claude call failed:', err.message);
    return TECH_ERROR_MSG;
  }
}
