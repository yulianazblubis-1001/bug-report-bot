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

  const title = report.title || '[Other] Bug Report';

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title, emoji: false },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Reporter:* ${profile?.name || session.senderName} (${profile?.zohoEmail || session.phoneNumber})`,
        },
        {
          type: 'mrkdwn',
          text: `*Category:* ${report.category || '—'}`,
        },
      ],
    },
  ];

  const pgFarmerParts: string[] = [];
  if (report.pgName) pgFarmerParts.push(report.pgName);
  if (report.farmerName) pgFarmerParts.push(report.farmerName);
  if (report.invoiceNumber) pgFarmerParts.push(`Invoice: ${report.invoiceNumber}`);
  const pgFarmerLine = pgFarmerParts.length > 0 ? pgFarmerParts.join(' / ') : '—';

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*PG/Farmer:* ${pgFarmerLine}`,
    },
  });

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Description:*\n${report.description || '—'}`,
    },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Steps to Reproduce:*\n${report.stepsToReproduce || 'Not provided'}`,
    },
  });

  const detailParts: string[] = [];
  detailParts.push(`*App Version:* ${report.appVersion || '—'}`);
  detailParts.push(`*Platform:* ${report.platform || '—'}`);

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: detailParts[0] },
      { type: 'mrkdwn', text: detailParts[1] },
    ],
  });

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Additional Info:* ${report.additionalInfo || '—'}` },
  });

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Original: ${report.originalText || '—'}_` }],
  });

  blocks.push({ type: 'divider' });

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
      elements: [{ type: 'mrkdwn', text: 'No photos attached' }],
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${timestamp} | +${session.phoneNumber} | ${profile?.area || '—'}` }],
  });

  return blocks;
}

function buildAdminRequestBlocks(session: BotSession): any[] {
  const report = session.parsedReport || {};
  const profile = session.profile;
  const timestamp = getWIBTimestamp();

  const title = report.title || '[Admin Request] Request';

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title, emoji: false },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Reporter:* ${profile?.name || session.senderName} (${profile?.zohoEmail || session.phoneNumber})`,
        },
        {
          type: 'mrkdwn',
          text: `*Category:* ${report.category || '—'}`,
        },
      ],
    },
  ];

  if (report.accountAffected) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Account Affected:* ${report.accountAffected}` },
    });
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Description:*\n${report.description || '—'}`,
    },
  });

  if (report.reason) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Reason:* ${report.reason}` },
    });
  }

  if (report.urgency) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Urgency:* ${report.urgency}` },
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Additional Info:* ${report.additionalInfo || '—'}` },
  });

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Original: ${report.originalText || '—'}_` }],
  });

  blocks.push({ type: 'divider' });

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
      elements: [{ type: 'mrkdwn', text: 'No photos attached' }],
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${timestamp} | +${session.phoneNumber} | ${profile?.area || '—'}` }],
  });

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
  const fallbackText = `${report.title || 'Report'} — ${session.profile?.name || session.senderName}`;

  console.log("MEDIA URLS IN SESSION:", session.mediaUrls);

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
