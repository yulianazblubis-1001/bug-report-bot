import Anthropic from '@anthropic-ai/sdk';
import { findRelevantContext } from './farmer-knowledge';
import { logQa } from '../farmer-kb-db';
import { postFarmerQuestionToSlack } from './slack';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Used for real technical failures (retrieval/API errors) — logged
// internally, never shown verbatim as a raw error to the farmer.
const FALLBACK_MSG = `Maaf, saya belum punya informasi soal itu. Coba hubungi Territory Manager atau agronomis kamu ya.

_(Sorry, I don't have information on that yet. Please contact your Territory Manager or agronomist.)_`;

// Sent when a genuine question has no grounded answer in the KB — the
// question gets escalated to Slack for Ops to follow up manually.
const ESCALATED_MSG = `Pertanyaan Anda sudah kami terima. Tim kami akan segera menghubungi Anda dalam beberapa jam.

We've received your question. Our team will reach out to you within a few hours.`;

async function translateToEnglish(anthropic: Anthropic, question: string): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      system: 'Translate the farmer message to English. Reply with ONLY the translation, no preamble or notes.',
      messages: [{ role: 'user', content: question }],
    });
    return (res.content[0] as any).text.trim();
  } catch (err: any) {
    console.error('[FarmerQA] Translation for Slack escalation failed:', err.message);
    return '(translation unavailable)';
  }
}

async function escalateUnanswered(
  anthropic: Anthropic,
  phoneNumber: string,
  senderName: string,
  question: string
): Promise<void> {
  const translated = await translateToEnglish(anthropic, question);
  await postFarmerQuestionToSlack(phoneNumber, senderName, question, translated);
}

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
    return FALLBACK_MSG;
  }

  if (context.length === 0) {
    await escalateUnanswered(anthropic, phoneNumber, senderName, question);
    await logQa({ phoneNumber, senderName, question, answer: ESCALATED_MSG, matchedSources: [] });
    return ESCALATED_MSG;
  }

  const contextText = context.map((c, i) => `[${i + 1}] (${c.source}) ${c.text}`).join('\n');

  const NO_ANSWER_SENTINEL = 'NO_ANSWER_IN_REFERENCE_DATA';

  const systemPrompt = `You are a friendly agricultural assistant for Rize.farm, helping Indonesian farmers over WhatsApp.

Answer the farmer's question using ONLY the reference data below. Never use general/outside agricultural knowledge, even if you're confident it's correct — only the reference data below is trustworthy for this farm's context. Be concise (2-5 sentences), practical, and specific (include exact numbers/dosages/names from the data when relevant).

Reply in casual, friendly Indonesian first, then a "---" separator, then a short English translation. Always bilingual, no exceptions.

If the reference data is weak, irrelevant, or does not actually answer the question, do NOT guess, generalize, or invent numbers, dosages, or recommendations. Instead, reply with EXACTLY this token and nothing else: ${NO_ANSWER_SENTINEL}

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

    const rawAnswer = (response.content[0] as any).text.trim();
    const isNoAnswer = rawAnswer.includes(NO_ANSWER_SENTINEL);
    if (isNoAnswer) {
      await escalateUnanswered(anthropic, phoneNumber, senderName, question);
    }
    const answer = isNoAnswer ? ESCALATED_MSG : rawAnswer;
    await logQa({
      phoneNumber,
      senderName,
      question,
      answer,
      matchedSources: isNoAnswer ? [] : Array.from(new Set(context.map((c) => c.source))),
    });
    return answer;
  } catch (err: any) {
    console.error('[FarmerQA] Claude call failed:', err.message);
    return FALLBACK_MSG;
  }
}
