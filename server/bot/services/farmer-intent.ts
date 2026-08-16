// Cheap, rule-based classifier that runs before retrieval + generation.
// Farmers reply to OUR outgoing messages (OTP, order confirmation, payment
// receipt, welcome broadcast) with short acknowledgements — those must never
// reach the auto-answer pipeline. `confident` marks whether the verdict is
// clear-cut; ambiguous cases are used by the caller as an extra signal when
// we've just sent that number a message (see outboundTracker.ts).
export interface IntentResult {
  isQuestion: boolean;
  confident: boolean;
}

const ACK_PHRASES = new Set([
  'ok', 'oke', 'okay', 'okey', 'siap', 'baik', 'baiklah', 'sip', 'oke sip', 'mantap',
  'oke siap', 'siap pak', 'siap bu', 'baik pak', 'baik bu',
  'terima kasih', 'makasih', 'terimakasih', 'thanks', 'thank you', 'thx', 'tks',
  'ya', 'iya', 'yaa', 'iyaa', 'yap', 'yoi',
  'ya benar', 'iya benar', 'benar', 'betul', 'ya betul', 'iya betul', 'benar pak', 'benar bu',
  'sudah', 'sudah pak', 'sudah bu', 'udah', 'done', 'noted', 'got it',
  'oke makasih', 'ok makasih', 'ok terima kasih', 'oke terima kasih',
  'siap makasih', 'siap terima kasih', 'baik terima kasih', 'baik makasih',
]);

const QUESTION_WORDS = [
  'apa', 'apakah', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'kapan', 'berapa',
  'dimana', 'di mana', 'kemana', 'ke mana', 'mana', 'kok', 'bisa', 'boleh',
  'tolong', 'minta', 'gimana cara', 'bantu', 'cara', 'apakan',
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu;

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(EMOJI_RE, '')
    .replace(/[.,!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyIntent(rawText: string): IntentResult {
  const normalized = normalize(rawText);

  if (!normalized) {
    return { isQuestion: false, confident: true };
  }

  if (ACK_PHRASES.has(normalized)) {
    return { isQuestion: false, confident: true };
  }

  const hasQuestionMark = rawText.includes('?');
  const words = normalized.split(/\s+/).filter(Boolean);
  const hasQuestionWord = QUESTION_WORDS.some((w) => normalized.includes(w));

  // Very short messages with no question mark/word read as closing remarks
  // ("makasih banyak ya", "siap laksanakan") even if not in the exact list.
  if (words.length <= 3 && !hasQuestionMark && !hasQuestionWord) {
    return { isQuestion: false, confident: false };
  }

  if (hasQuestionMark || hasQuestionWord) {
    return { isQuestion: true, confident: true };
  }

  // Longer message with no explicit question marker — likely still a
  // question/request (farmers often skip "?"), but not clear-cut.
  return { isQuestion: true, confident: false };
}
