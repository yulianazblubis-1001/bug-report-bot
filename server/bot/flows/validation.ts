const REJECTION_MSG = '⚠️ Maaf, jawaban tidak valid. Tolong jawab dengan lebih detail ya 🙏';

export function isGarbageInput(text: string): boolean {
  if (!text) return true;
  const cleaned = text.trim();
  if (cleaned.length === 0) return true;
  if (cleaned.length === 1 && !/[0-9]/.test(cleaned)) return true;
  if (/^[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+$/.test(cleaned)) return true;
  return false;
}

export function validateTextInput(
  text: string,
  minLength: number
): string | null {
  if (isGarbageInput(text)) return REJECTION_MSG;
  if (text.trim().length < minLength) return REJECTION_MSG;
  return null;
}

export { REJECTION_MSG };
