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

function buildBugReportBlocks(session: BotSession): any[] {
  const report = session.parsedReport || {};
  const profile = session.profile;
  const timestamp = getWIBTimestamp();

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🐛 BUG REPORT | ${report.title || 'Bug Report'}`, emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*👤 Reporter:*\n${profile?.name || session.senderName} (${profile?.zohoEmail || session.phoneNumber})`,
        },
        {
          type: 'mrkdwn',
          text: `*📍 Area:*\n${profile?.area || '—'}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*📱 Phone:*\n+${session.phoneNumber}`,
        },
        {
          type: 'mrkdwn',
          text: `*🕐 Submitted:*\n${timestamp}`,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:*\n${report.description || '—'}`,
      },
    },
  ];

  if (report.stepsToReproduce) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Steps to Reproduce:*\n${report.stepsToReproduce}` },
    });
  }

  const details: string[] = [];
  if (report.platform) details.push(`*Platform:* ${report.platform}`);
  if (report.appVersion) details.push(`*App Version:* ${report.appVersion}`);
  if (report.category) details.push(`*Category:* ${report.category}`);
  if (report.relatedInfo) details.push(`*Related:* ${report.relatedInfo}`);

  if (details.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: details.join('\n') },
    });
  }

  if (session.mediaUrls.length > 0) {
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
      elements: [{ type: 'mrkdwn', text: '_No screenshot attached_' }],
    });
  }

  return blocks;
}

function buildAdminRequestBlocks(session: BotSession): any[] {
  const report = session.parsedReport || {};
  const profile = session.profile;
  const timestamp = getWIBTimestamp();

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `⚙️ ADMIN REQUEST | ${report.title || 'Admin Request'}`, emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*👤 Requestor:*\n${profile?.name || session.senderName} (${profile?.zohoEmail || session.phoneNumber})`,
        },
        {
          type: 'mrkdwn',
          text: `*📍 Area:*\n${profile?.area || '—'}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*📱 Phone:*\n+${session.phoneNumber}`,
        },
        {
          type: 'mrkdwn',
          text: `*🕐 Submitted:*\n${timestamp}`,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Request:*\n${report.description || '—'}`,
      },
    },
  ];

  const details: string[] = [];
  if (report.accountAffected) details.push(`*Account Affected:* ${report.accountAffected}`);
  if (report.reason) details.push(`*Reason:* ${report.reason}`);
  if (report.urgency) details.push(`*Urgency:* ${report.urgency}`);
  if (report.category) details.push(`*Category:* ${report.category}`);

  if (details.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: details.join('\n') },
    });
  }

  if (session.mediaUrls.length > 0) {
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
      elements: [{ type: 'mrkdwn', text: '_No screenshot attached_' }],
    });
  }

  return blocks;
}

export async function postToSlack(
  session: BotSession,
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
      ? buildBugReportBlocks(session)
      : buildAdminRequestBlocks(session);

  const report = session.parsedReport || {};
  const fallbackText =
    session.reportType === 'bug'
      ? `🐛 Bug Report from ${session.profile?.name || session.senderName}: ${report.title || ''}`
      : `⚙️ Admin Request from ${session.profile?.name || session.senderName}: ${report.title || ''}`;

  try {
    const res = await axios.post(webhookUrl, {
      text: fallbackText,
      blocks: blocks,
    });
    console.log(`[Slack] Posted ${session.reportType} report from ${session.profile?.name || session.senderName}`);
    if (res.data?.ts && res.data?.channel && onSlackTs) {
      onSlackTs(res.data.ts, res.data.channel);
    }
    return res.data;
  } catch (err: any) {
    console.error('[Slack] Error posting:', err.response?.data || err.message);
    throw err;
  }
}
