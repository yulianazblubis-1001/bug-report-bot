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

async function translateText(text: string): Promise<{ original: string; translated: string }> {
  if (!text || text.trim() === '' || text.trim().toLowerCase() === 'skip') {
    return { original: text || '', translated: text || '' };
  }

  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[Translate] No ANTHROPIC_API_KEY set, skipping translation');
    return { original: text, translated: text };
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    const content = (response.content[0] as any).text.trim();
    const parsed = JSON.parse(content);
    return {
      original: parsed.original || text,
      translated: parsed.translated || text,
    };
  } catch (err: any) {
    console.error('[Translate] Error:', err.message);
    return { original: text, translated: text };
  }
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

  for (const field of fieldsToTranslate) {
    if (data[field] && data[field].toLowerCase() !== 'skip') {
      const result = await translateText(data[field]);
      translated[`${field}_original`] = result.original;
      translated[`${field}_translated`] = result.translated;
    }
  }

  return translated;
}
