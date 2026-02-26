import axios from 'axios';
import type { BotSession } from '../session';

function getWIBTimestamp(): string {
  const now = new Date();
  return (
    now.toLocaleString('en-GB', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' WIB'
  );
}

function formatTranslatedField(data: Record<string, any>, fieldName: string): string {
  const translated = data[`${fieldName}_translated`];
  const original = data[`${fieldName}_original`];

  if (!translated && !data[fieldName]) return '—';
  if (!translated) return data[fieldName];
  if (translated === original) return translated;

  return `${translated}\n_Original: ${original}_`;
}

function buildBugReportBlocks(session: BotSession, data: Record<string, any>): any[] {
  const timestamp = getWIBTimestamp();
  const hasMedia = session.mediaUrls && session.mediaUrls.length > 0;

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'BUG REPORT | Rize.farm', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Reporter:*\n${session.senderName} | ${session.phoneNumber}` },
        { type: 'mrkdwn', text: `*Platform:*\n${data.platform || '—'} | App ${data.appVersion || '—'}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Account:*\n${data.accountInfo || '—'}` },
        { type: 'mrkdwn', text: `*Submitted:*\n${timestamp}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*What Happened:*\n${formatTranslatedField(data, 'whatHappened')}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Steps to Reproduce:*\n${formatTranslatedField(data, 'stepsToReproduce')}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Related Info (Task/PG/Farmer/Season):*\n${formatTranslatedField(data, 'relatedInfo')}`,
      },
    },
  ];

  if (hasMedia) {
    for (const url of session.mediaUrls) {
      blocks.push({
        type: 'image',
        image_url: url,
        alt_text: 'Screenshot from reporter',
      });
    }
  } else {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'No screenshot attached' }],
    });
  }

  return blocks;
}

function buildAdminRequestBlocks(session: BotSession, data: Record<string, any>): any[] {
  const timestamp = getWIBTimestamp();
  const hasMedia = session.mediaUrls && session.mediaUrls.length > 0;

  const urgencyMap: Record<string, string> = { '1': 'Low', '2': 'Medium', '3': 'High' };
  const urgency = urgencyMap[data.urgency] || data.urgency || '—';

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'ADMIN REQUEST | Rize.farm', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Requestor:*\n${session.senderName} | ${session.phoneNumber}` },
        { type: 'mrkdwn', text: `*Urgency:*\n${urgency}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Account Affected:*\n${data.accountAffected || '—'}` },
        { type: 'mrkdwn', text: `*Submitted:*\n${timestamp}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Request:*\n${formatTranslatedField(data, 'requestDescription')}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Additional Context:*\n${formatTranslatedField(data, 'additionalContext')}`,
      },
    },
  ];

  if (hasMedia) {
    for (const url of session.mediaUrls) {
      blocks.push({
        type: 'image',
        image_url: url,
        alt_text: 'Screenshot from requestor',
      });
    }
  } else {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'No screenshot attached' }],
    });
  }

  return blocks;
}

export async function postToSlack(
  session: BotSession,
  translatedData: Record<string, any>,
  onSlackTs?: (ts: string, channel: string) => void
): Promise<any> {
  const webhookUrl =
    session.reportType === 'bug'
      ? process.env.SLACK_WEBHOOK_BUG
      : process.env.SLACK_WEBHOOK_ADMIN;

  if (!webhookUrl) {
    console.error(`[Slack] No webhook URL set for ${session.reportType}`);
    return null;
  }

  const blocks =
    session.reportType === 'bug'
      ? buildBugReportBlocks(session, translatedData)
      : buildAdminRequestBlocks(session, translatedData);

  const fallbackText =
    session.reportType === 'bug'
      ? `Bug Report from ${session.senderName}`
      : `Admin Request from ${session.senderName}`;

  try {
    const res = await axios.post(webhookUrl, {
      text: fallbackText,
      blocks: blocks,
    });
    console.log(`[Slack] Posted ${session.reportType} report from ${session.senderName}`);
    if (res.data?.ts && res.data?.channel && onSlackTs) {
      onSlackTs(res.data.ts, res.data.channel);
    }
    return res.data;
  } catch (err: any) {
    console.error('[Slack] Error posting:', err.response?.data || err.message);
    throw err;
  }
}
