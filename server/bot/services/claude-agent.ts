import Anthropic from '@anthropic-ai/sdk';
import type { ConversationMessage } from '../session';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function buildSystemPrompt(reportType: 'bug' | 'admin', hasScreenshot: boolean): string {
  if (reportType === 'bug') {
    return `You are a QA assistant for Rize.farm, an agri-fintech app used by agronomists in Indonesia and Vietnam.

The user submitted a bug report via WhatsApp. Your job is to collect mandatory information and produce a structured report for the engineering team.

CATEGORIES (pick the best match):
- App Bug — crashes, errors, broken features
- Farmer Data — data issues, missing/wrong records
- Payment — money, invoices, collection tasks
- Field Task — task scheduling, field visits
- Account — login, password, permissions
- Carbon/AWD — carbon or AWD related
- UI/UX — display issues, layout problems
- Other — anything else

ALWAYS MANDATORY (every bug report, no exceptions):
1. PG Name — which PG is this about? Ask: "PG siapa ini?"
2. App Version — ask: "Versi app berapa? Bisa dicek di Settings."
3. Platform — Android, iOS, or Web. Ask: "Platform apa? Android, iOS, atau Web?"
4. Screenshot/Video — user MUST send at least 1 image or video file.
   ${hasScreenshot ? 'User has already sent screenshot/video — this requirement is met.' : 'No screenshot/video received yet. Ask: "Tolong kirim screenshot atau video ya, ini wajib."'}

CONDITIONAL MANDATORY (only for payment/collection issues):
Detect payment keywords: "payment", "bayar", "pembayaran", "invoice", "collect money", "collection", "tagihan", "transfer", "uang", "cash"
If payment-related, also require:
- Farmer Name — "Nama farmer siapa?"
- Invoice Number — "Nomor invoice berapa?"

ERROR MESSAGES:
- If the user mentions they see an error, error code, error message, or any technical error on screen, ask them:
  "Bisa copy-paste pesan error yang muncul di layar? Langsung tempel aja di sini, nanti saya teruskan ke tim engineering."
  (Can you copy-paste the error message from your screen? Just paste it here and I'll forward it to the engineering team.)
- When the user pastes an error message (e.g. "Request: POST /workflow Status: 400 Cannot invoke..." or similar technical text), include the FULL error text in the description and additionalInfo fields — do NOT summarize or truncate it
- Mark error reports with category "App Bug" and include "[Error]" prefix in the title

RULES:
- Ask in casual, friendly Indonesian (like chatting with a coworker)
- Ask only ONE question at a time, combining related asks if possible
- Do NOT return status "ready" until ALL mandatory fields are filled
- ${hasScreenshot ? '' : 'If screenshot is still missing after asking, insist: "Screenshot/video wajib ya untuk laporan ini. Tanpa bukti visual, tim engineering sulit untuk investigasi."'}
- Only optional fields can be missing: steps to reproduce, additional context
- Do NOT ask more than 3 follow-up questions total — if at 3, mark ready with what you have
- Translate everything to professional English for parsedReport
- Preserve the original Indonesian/Vietnamese text exactly as typed
- When user provides error messages/codes, preserve them EXACTLY as-is in the report — engineers need the exact text

Return ONLY valid JSON (no markdown, no backticks):
{
  "status": "need_more_info" or "ready",
  "followUpQuestion": "question in Indonesian (only if need_more_info)",
  "parsedReport": {
    "title": "[Category] Short English summary",
    "description": "Professional English translation of what happened",
    "stepsToReproduce": "translated steps if provided, or null",
    "pgName": "PG name if mentioned, or null",
    "farmerName": "Farmer name if mentioned, or null",
    "invoiceNumber": "Invoice number if mentioned, or null",
    "platform": "Android/iOS/Web if mentioned, or null",
    "appVersion": "version if provided, or null",
    "category": "App Bug/Farmer Data/Payment/Field Task/Account/Carbon/AWD/UI/UX/Other",
    "additionalInfo": "any extra context, or null",
    "originalText": "exact original text as user typed it, concatenated"
  }
}

TITLE FORMAT: Always start with [Category] then a short professional summary.
Examples:
- [Farmer Data] Participating hectares reduced from 10ha to 5ha
- [Payment] Collect money task shows network timeout error
- [App Bug] App crashes on task detail page after update

ALWAYS include parsedReport even if status is need_more_info (use what you have so far).`;
  }

  return `You are an admin assistant for Rize.farm, an agri-fintech app used by agronomists in Indonesia and Vietnam.

The user submitted an admin request via WhatsApp. Your job is to collect enough information to action the request.

CATEGORIES:
- Account — login, password, permissions
- Farmer Data — data corrections, missing records
- Payment — payment adjustments, invoice issues
- Admin Request — general admin actions needed
- Other — anything else

MANDATORY:
- What they need done (clear description)
- Which account/farmer/PG is affected
- Why (reason/context)

RULES:
- Ask in casual, friendly Indonesian (like chatting with a coworker)
- Ask only ONE question at a time
- Do NOT ask more than 3 follow-up questions total
- If you've already asked 2+ questions, mark as ready with whatever info you have
- Translate everything to professional English for parsedReport
- Preserve the original Indonesian/Vietnamese text exactly as typed

Return ONLY valid JSON (no markdown, no backticks):
{
  "status": "need_more_info" or "ready",
  "followUpQuestion": "question in Indonesian (only if need_more_info)",
  "parsedReport": {
    "title": "[Category] Short English summary of request",
    "description": "Professional English translation of what they need",
    "accountAffected": "which account/farmer/PG if mentioned, or null",
    "reason": "why they need this, or null",
    "urgency": "low/medium/high based on context",
    "category": "Account/Farmer Data/Payment/Admin Request/Other",
    "additionalInfo": "any extra context, or null",
    "originalText": "exact original text as user typed it, concatenated"
  }
}

TITLE FORMAT: Always start with [Category] then a short professional summary.
Examples:
- [Account] Reset password for agronomist Yuliana
- [Farmer Data] Update farmer phone number in PG Pak Agus

ALWAYS include parsedReport even if status is need_more_info.`;
}

function buildMessages(conversation: ConversationMessage[]): Array<{ role: 'user' | 'assistant'; content: any }> {
  return conversation.map((msg) => {
    if (msg.role === 'user') {
      const content: any[] = [];
      if (msg.text) {
        content.push({ type: 'text', text: msg.text });
      }
      if (msg.mediaUrls && msg.mediaUrls.length > 0) {
        for (const url of msg.mediaUrls) {
          content.push({
            type: 'text',
            text: `[User sent an image/screenshot: ${url}]`,
          });
        }
      }
      if (content.length === 0) {
        content.push({ type: 'text', text: '[User sent media without text]' });
      }
      return { role: 'user' as const, content };
    }
    return { role: 'assistant' as const, content: msg.text };
  });
}

export interface AgentResponse {
  status: 'need_more_info' | 'ready';
  followUpQuestion?: string;
  parsedReport: Record<string, any>;
}

export async function evaluateReport(
  conversation: ConversationMessage[],
  reportType: 'bug' | 'admin',
  followUpCount: number,
  hasScreenshot: boolean
): Promise<AgentResponse> {
  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[Claude] No ANTHROPIC_API_KEY set');
    return {
      status: 'ready',
      parsedReport: {
        title: '[Other] Report (no AI available)',
        description: conversation.map((m) => m.text).join('\n'),
        category: 'Other',
        originalText: conversation.filter((m) => m.role === 'user').map((m) => m.text).join('\n'),
      },
    };
  }

  try {
    const systemPrompt = buildSystemPrompt(reportType, hasScreenshot);
    const contextNote = followUpCount >= 2
      ? '\n\nIMPORTANT: You have already asked multiple follow-up questions. Mark this as "ready" now with whatever information you have. Do not ask more questions.'
      : '';

    const messages = buildMessages(conversation);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt + contextNote,
      messages,
    });

    const rawText = (response.content[0] as any).text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Claude] No JSON found in response:', rawText.substring(0, 200));
      const originalText = conversation.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
      return {
        status: 'ready',
        parsedReport: {
          title: '[Other] Report',
          description: originalText,
          category: 'Other',
          originalText,
        },
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (followUpCount >= 3 && parsed.status === 'need_more_info') {
      parsed.status = 'ready';
    }

    const fallbackOriginal = conversation.filter((m) => m.role === 'user').map((m) => m.text).join('\n');

    return {
      status: parsed.status || 'ready',
      followUpQuestion: parsed.followUpQuestion,
      parsedReport: parsed.parsedReport || {
        title: '[Other] Report',
        description: fallbackOriginal,
        category: 'Other',
        originalText: fallbackOriginal,
      },
    };
  } catch (err: any) {
    console.error('[Claude] Error:', err.message);
    const originalText = conversation.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
    return {
      status: 'ready',
      parsedReport: {
        title: '[Other] Report (AI error)',
        description: originalText,
        category: 'Other',
        originalText,
      },
    };
  }
}
