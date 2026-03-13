import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a translator for Rize.farm, a farming tech company in Indonesia and Vietnam.

Your job:
1. Detect if the text is Indonesian, Vietnamese, or English
2. If already English, return it as-is
3. If Indonesian or Vietnamese, translate to clear professional English
4. Fix typos and informal language, but keep the technical meaning

IMPORTANT: Do NOT add interpretation. Do NOT add information that isn't there. 
Just translate what the user wrote, nothing more.

Return ONLY valid JSON in this format:
{"original": "the original text", "translated": "the english translation"}

If the text is already English, set translated to be the same as original.`;

const RETRY_DELAYS_MS = [500, 1500];

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function attemptTranslation(
  anthropic: Anthropic,
  text: string
): Promise<{ original: string; translated: string }> {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });

  const content = (response.content[0] as any).text.trim();

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in response: ${content.substring(0, 100)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.translated) {
    throw new Error('Missing "translated" field in response');
  }

  return {
    original: parsed.original || text,
    translated: parsed.translated,
  };
}

async function translateText(
  text: string,
  fieldName: string
): Promise<{ original: string; translated: string; failed: boolean }> {
  if (!text || text.trim() === '' || text.trim().toLowerCase() === 'skip') {
    return { original: text || '', translated: text || '', failed: false };
  }

  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[Translate] No ANTHROPIC_API_KEY set, skipping translation');
    return { original: text, translated: text, failed: false };
  }

  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await attemptTranslation(anthropic, text);
      if (attempt > 1) {
        console.log(`[Translate] "${fieldName}" succeeded on attempt ${attempt}`);
      }
      return { ...result, failed: false };
    } catch (err: any) {
      console.error(`[Translate] "${fieldName}" attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        console.log(`[Translate] Retrying "${fieldName}" in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  console.error(`[Translate] "${fieldName}" failed after ${maxAttempts} attempts — using original text with [ID] tag`);
  return { original: text, translated: `[ID] ${text}`, failed: true };
}

export async function translateReport(
  data: Record<string, any>,
  reportType: string
): Promise<Record<string, any>> {
  const fieldsToTranslate =
    reportType === 'bug'
      ? ['whatHappened', 'stepsToReproduce', 'relatedInfo']
      : ['requestDescription', 'additionalContext'];

  const translated = { ...data };
  const failedFields: string[] = [];

  for (const field of fieldsToTranslate) {
    if (data[field] && data[field].toLowerCase() !== 'skip') {
      const result = await translateText(data[field], field);
      translated[`${field}_original`] = result.original;
      translated[`${field}_translated`] = result.translated;
      if (result.failed) {
        failedFields.push(field);
      }
    }
  }

  if (failedFields.length > 0) {
    console.warn(`[Translate] Report had ${failedFields.length} untranslated field(s): ${failedFields.join(', ')}`);
  }

  return translated;
}
