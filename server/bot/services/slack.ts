import axios from 'axios';
import FormData from 'form-data';
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

function buildMediaLine(mediaCount: number): any {
  if (mediaCount > 0) {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Screenshots:* ${mediaCount} file${mediaCount > 1 ? 's' : ''} attached below`,
      },
    };
  }
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'No photos attached' }],
  };
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

  blocks.push(buildMediaLine(session.mediaUrls.length));

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

  blocks.push(buildMediaLine(session.mediaUrls.length));

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${timestamp} | +${session.phoneNumber} | ${profile?.area || '—'}` }],
  });

  return blocks;
}

function getFileExtension(url: string): string {
  const cleanUrl = url.split('?')[0];
  const ext = cleanUrl.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return ext;
  if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return ext;
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) return ext;
  return 'jpg';
}

async function uploadFileToSlack(
  botToken: string,
  channelId: string,
  threadTs: string,
  mediaUrl: string,
  index: number
): Promise<void> {
  try {
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const fileBuffer = Buffer.from(response.data);
    const ext = getFileExtension(mediaUrl);
    const filename = `screenshot_${index + 1}.${ext}`;

    const form = new FormData();
    form.append('file', fileBuffer, { filename, contentType: response.headers['content-type'] || 'image/jpeg' });
    form.append('channels', channelId);
    form.append('thread_ts', threadTs);
    form.append('initial_comment', `Screenshot ${index + 1}`);

    const uploadRes = await axios.post('https://slack.com/api/files.upload', form, {
      headers: {
        Authorization: `Bearer ${botToken}`,
        ...form.getHeaders(),
      },
      maxContentLength: 50 * 1024 * 1024,
    });

    if (!uploadRes.data.ok) {
      console.error(`[Slack] File upload error for screenshot ${index + 1}:`, uploadRes.data.error);
    } else {
      console.log(`[Slack] Uploaded screenshot_${index + 1}.${ext} to thread`);
    }
  } catch (err: any) {
    console.error(`[Slack] Failed to upload screenshot ${index + 1}:`, err.message);
  }
}

export async function postToSlack(
  session: BotSession,
  onSlackTs?: (ts: string, channel: string) => void
): Promise<any> {
  const blocks =
    session.reportType === 'bug'
      ? buildBugReportBlocks(session)
      : buildAdminRequestBlocks(session);

  const report = session.parsedReport || {};
  const fallbackText = `${report.title || 'Report'} — ${session.profile?.name || session.senderName}`;

  console.log("MEDIA URLS IN SESSION:", session.mediaUrls);

  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = session.reportType === 'bug'
    ? process.env.SLACK_CHANNEL_BUG
    : process.env.SLACK_CHANNEL_ADMIN;

  if (botToken && channelId) {
    try {
      const res = await axios.post('https://slack.com/api/chat.postMessage', {
        channel: channelId,
        text: fallbackText,
        blocks: blocks,
      }, {
        headers: { Authorization: `Bearer ${botToken}` },
      });

      if (!res.data.ok) {
        console.error('[Slack] Web API error:', res.data.error);
        throw new Error(`Slack API: ${res.data.error}`);
      }

      const messageTs = res.data.ts;
      const messageChannel = res.data.channel;

      console.log(`[Slack] Posted ${session.reportType} report via Web API from ${session.profile?.name || session.senderName} (ts: ${messageTs})`);

      if (messageTs && messageChannel && onSlackTs) {
        onSlackTs(messageTs, messageChannel);
      }

      if (session.mediaUrls.length > 0 && messageTs) {
        for (let i = 0; i < session.mediaUrls.length; i++) {
          await uploadFileToSlack(botToken, channelId, messageTs, session.mediaUrls[i], i);
        }
      }

      return res.data;
    } catch (err: any) {
      console.error('[Slack] Web API failed:', err.response?.data || err.message);
      console.log('[Slack] Falling back to webhook...');
    }
  }

  const webhookUrl =
    session.reportType === 'bug'
      ? process.env.SLACK_WEBHOOK_BUG
      : process.env.SLACK_WEBHOOK_ADMIN;

  if (!webhookUrl) {
    console.error(`[Slack] No webhook URL or bot token configured for ${session.reportType}`);
    throw new Error('No Slack posting method available');
  }

  try {
    const res = await axios.post(webhookUrl, {
      text: fallbackText,
      blocks: blocks,
    });
    console.log(`[Slack] Posted ${session.reportType} report via webhook from ${session.profile?.name || session.senderName} (no ts available for reaction mapping)`);
    return res.data;
  } catch (err: any) {
    console.error('[Slack] Webhook error:', err.response?.data || err.message);
    throw err;
  }
}
