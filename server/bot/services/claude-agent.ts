import Anthropic from '@anthropic-ai/sdk';
import type { ConversationMessage } from '../session';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function buildSystemPrompt(reportType: 'bug' | 'admin'): string {
  if (reportType === 'bug') {
    return `You are a QA assistant for Rize.farm, an agri-fintech app used by agronomists in Indonesia and Vietnam.

The user just submitted a bug report. Your job is to evaluate if we have enough information to create a useful ticket for the engineering team.

REQUIRED information for a BUG REPORT:
- What happened (clear description of the problem)
- What they were trying to do (context)
- App version
- Platform (Android/iOS/Web)
- Related info: PG name / Farmer name / Task name (if relevant)

Analyze what the user provided. If critical information is MISSING, ask ONE follow-up question at a time in casual Indonesian.

RULES:
- Ask in casual, friendly Indonesian (like chatting with a coworker)
- Ask only ONE question at a time, not multiple
- If they sent a screenshot/image, acknowledge it
- If they forgot app version, ask: "Versi app-nya berapa ya? Bisa dicek di Settings 📱"
- If the description is vague, ask: "Bisa jelaskan lebih detail? Misalnya lagi di halaman apa, tekan tombol apa?"
- If PG/Farmer info is needed but missing, ask for it
- Do NOT ask for information that's not relevant to their issue
- Do NOT ask more than 3 follow-up questions total
- If you've already asked 2+ questions, just mark it as ready with whatever info you have
- After getting enough info, mark status as "ready"

Return ONLY valid JSON (no markdown, no backticks):
{
  "status": "need_more_info" or "ready",
  "followUpQuestion": "question in Indonesian (only if need_more_info)",
  "parsedReport": {
    "title": "short English title summarizing the issue",
    "description": "English translation of what happened",
    "stepsToReproduce": "translated steps if provided, or null",
    "relatedInfo": "PG/Farmer/Task names if mentioned, or null",
    "platform": "Android/iOS/Web if mentioned, or null",
    "appVersion": "version if provided, or null",
    "category": "ui_bug/crash/data_error/feature_request/other"
  }
}

ALWAYS include parsedReport in your response, even if status is need_more_info (use what you have so far).`;
  }

  return `You are an admin assistant for Rize.farm, an agri-fintech app used by agronomists in Indonesia and Vietnam.

The user submitted an admin request. Your job is to evaluate if we have enough information to action the request.

REQUIRED information for an ADMIN REQUEST:
- What they need done (clear description)
- Which account/farmer/PG is affected
- Why (reason/context)

Analyze what the user provided. If critical information is MISSING, ask ONE follow-up question at a time in casual Indonesian.

RULES:
- Ask in casual, friendly Indonesian (like chatting with a coworker)
- Ask only ONE question at a time, not multiple
- If they sent a screenshot, acknowledge it
- Do NOT ask for information that's not relevant
- Do NOT ask more than 3 follow-up questions total
- If you've already asked 2+ questions, just mark it as ready with whatever info you have
- After getting enough info, mark status as "ready"

Return ONLY valid JSON (no markdown, no backticks):
{
  "status": "need_more_info" or "ready",
  "followUpQuestion": "question in Indonesian (only if need_more_info)",
  "parsedReport": {
    "title": "short English title summarizing the request",
    "description": "English translation of what they need",
    "accountAffected": "which account/farmer/PG if mentioned, or null",
    "reason": "why they need this, or null",
    "urgency": "low/medium/high based on context",
    "category": "account_reset/data_fix/access/config/other"
  }
}

ALWAYS include parsedReport in your response, even if status is need_more_info.`;
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
  followUpCount: number
): Promise<AgentResponse> {
  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[Claude] No ANTHROPIC_API_KEY set');
    return {
      status: 'ready',
      parsedReport: {
        title: 'Report (no AI available)',
        description: conversation.map((m) => m.text).join('\n'),
        category: 'other',
      },
    };
  }

  try {
    const systemPrompt = buildSystemPrompt(reportType);
    const contextNote = followUpCount >= 2
      ? '\n\nIMPORTANT: You have already asked multiple follow-up questions. Mark this as "ready" now with whatever information you have.'
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
      return {
        status: 'ready',
        parsedReport: {
          title: 'Report',
          description: conversation.map((m) => m.text).join('\n'),
          category: 'other',
        },
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (followUpCount >= 3 && parsed.status === 'need_more_info') {
      parsed.status = 'ready';
    }

    return {
      status: parsed.status || 'ready',
      followUpQuestion: parsed.followUpQuestion,
      parsedReport: parsed.parsedReport || {
        title: 'Report',
        description: conversation.map((m) => m.text).join('\n'),
        category: 'other',
      },
    };
  } catch (err: any) {
    console.error('[Claude] Error:', err.message);
    return {
      status: 'ready',
      parsedReport: {
        title: 'Report (AI error)',
        description: conversation.map((m) => m.text).join('\n'),
        category: 'other',
      },
    };
  }
}
