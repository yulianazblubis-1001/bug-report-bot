import axios from 'axios';
import type { BotSession } from '../session';

function formatIDR(value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return String(value);
  return `IDR ${num.toLocaleString('en-US')}`;
}

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

function buildBugReportBlocks(session: BotSession, reportNumber?: string): any[] {
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
          text: `*Report Number:* ${reportNumber || '—'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Category:* ${report.category || '—'}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Reporter:* ${profile?.name || session.senderName} (${profile?.zohoEmail || session.phoneNumber})`,
        },
        {
          type: 'mrkdwn',
          text: `*Area:* ${profile?.area || '—'}`,
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

  if (report.errorDetails && report.errorDetails !== '—') {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Error Details:*\n\`\`\`${report.errorDetails}\`\`\`` },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Error Details:* ${report.errorDetails || '—'}` },
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Additional Info:* ${report.additionalInfo || '—'}` },
  });

  if (report.originalText) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_Original: ${report.originalText}_` }],
    });
  }

  blocks.push({ type: 'divider' });

  blocks.push(buildMediaLine(session.mediaUrls.length));

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${timestamp} | +${session.phoneNumber} | ${profile?.area || '—'}` }],
  });

  return blocks;
}

function isFarmerPhoneChangeRequest(report: Record<string, any>): { matched: boolean; keywordsHit: string[] } {
  const category = (report.category || '').toLowerCase();
  if (category !== 'farmer data') {
    return { matched: false, keywordsHit: [] };
  }

  const haystack = `${report.title || ''} ${report.description || ''}`.toLowerCase();

  const phoneKeywords = ['phone number', 'whatsapp number', 'wa number', 'phone no', 'hp number'];
  const changeKeywords = ['change', 'update', 'new', 'edit', 'modify', 'replace'];

  const hitPhone = phoneKeywords.filter(kw => haystack.includes(kw));
  const hitChange = changeKeywords.filter(kw => haystack.includes(kw));

  const matched = hitPhone.length > 0 && hitChange.length > 0;
  const keywordsHit = [...hitPhone, ...hitChange];

  return { matched, keywordsHit };
}

function buildAdminRequestBlocks(session: BotSession, reportNumber?: string): any[] {
  const report = session.parsedReport || {};
  const profile = session.profile;
  const timestamp = getWIBTimestamp();

  const title = report.title || '[Admin Request] Request';

  const { matched: mentionMeisisko, keywordsHit } = isFarmerPhoneChangeRequest(report);
  console.log('[MEISISKO_MENTION] category:', report.category || '—', '| matched:', mentionMeisisko, '| keywords_hit:', keywordsHit);

  const blocks: any[] = [];

  if (mentionMeisisko) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<@U0AAVDJHD62> — farmer phone number change request` },
    });
  }

  blocks.push(
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
          text: `*Report Number:* ${reportNumber || '—'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Category:* ${report.category || '—'}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Reporter:* ${profile?.name || session.senderName} (${profile?.zohoEmail || session.phoneNumber})`,
        },
        {
          type: 'mrkdwn',
          text: `*Area:* ${profile?.area || '—'}`,
        },
      ],
    },
  );

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

  if (report.originalText) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_Original: ${report.originalText}_` }],
    });
  }

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

  const fileNameMatch = url.match(/fileName=.*?\.(\w+)/i);
  if (fileNameMatch) {
    const parsed = fileNameMatch[1].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'avi', 'webm', 'mkv', 'pdf'].includes(parsed)) {
      return parsed;
    }
  }

  return 'jpg';
}

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
};

function getMimeType(ext: string, serverContentType: string): string {
  if (MIME_MAP[ext]) return MIME_MAP[ext];
  if (serverContentType && serverContentType !== 'application/octet-stream') return serverContentType;
  return 'application/octet-stream';
}

async function uploadFileToSlack(
  botToken: string,
  channelId: string,
  threadTs: string,
  mediaUrl: string,
  index: number
): Promise<void> {
  try {
    console.log(`[Slack Upload] Step 1: Downloading from ${mediaUrl}`);
    const downloadHeaders: Record<string, string> = {};
    if (mediaUrl.includes('wati.io') && process.env.WATI_TOKEN) {
      const token = process.env.WATI_TOKEN;
      downloadHeaders['Authorization'] = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
    }
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 60000, headers: downloadHeaders });
    const fileBuffer = Buffer.from(response.data);
    const serverContentType = response.headers['content-type'] || 'application/octet-stream';

    const ext = getFileExtension(mediaUrl);
    const contentType = getMimeType(ext, serverContentType);
    const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext);
    const filename = isVideo ? `video_${index + 1}.${ext}` : `screenshot_${index + 1}.${ext}`;
    const label = isVideo ? `Video ${index + 1}` : `Screenshot ${index + 1}`;

    console.log(`[Slack Upload] Downloaded ${fileBuffer.length} bytes, server-type: ${serverContentType}, resolved-type: ${contentType}, ext: ${ext}`);

    console.log(`[Slack Upload] Step 2: Getting upload URL for ${filename} (${fileBuffer.length} bytes)...`);
    const urlRes = await axios.get('https://slack.com/api/files.getUploadURLExternal', {
      params: { filename, length: fileBuffer.length },
      headers: { Authorization: `Bearer ${botToken}` },
    });

    if (!urlRes.data.ok) {
      console.error(`[Slack Upload] getUploadURLExternal failed:`, urlRes.data.error);
      return;
    }

    const uploadUrl = urlRes.data.upload_url;
    const fileId = urlRes.data.file_id;
    console.log(`[Slack Upload] Step 3: Uploading file content (file_id: ${fileId})...`);

    await axios.post(uploadUrl, fileBuffer, {
      headers: { 'Content-Type': contentType },
      maxContentLength: 50 * 1024 * 1024,
    });

    console.log(`[Slack Upload] Step 4: Completing upload to channel ${channelId} thread ${threadTs}...`);
    const completeRes = await axios.post('https://slack.com/api/files.completeUploadExternal', {
      files: [{ id: fileId, title: label }],
      channel_id: channelId,
      thread_ts: threadTs,
      initial_comment: label,
    }, {
      headers: { Authorization: `Bearer ${botToken}` },
    });

    if (!completeRes.data.ok) {
      console.error(`[Slack Upload] completeUploadExternal failed:`, completeRes.data.error);
    } else {
      console.log(`[Slack Upload] Successfully uploaded ${filename} to thread`);
    }
  } catch (err: any) {
    console.error(`[Slack Upload] Failed for file ${index + 1}:`, err.message);
    if (err.response) {
      console.error(`[Slack Upload] Response status: ${err.response.status}, data:`, JSON.stringify(err.response.data).substring(0, 500));
    }
  }
}

export function buildCreditLimitBlocks(session: BotSession, data: Record<string, any>, reportNumber?: string): any[] {
  const profile = session.profile;
  const timestamp = getWIBTimestamp();
  const isLargeFarmer = data.creditLimitType === 'largeFarmer';
  const creditType = data.creditType || '';
  const includesAgriInput = creditType.includes('Agri Input');
  const includesMechanization = creditType.includes('Mechanization');

  const headerText = isLargeFarmer
    ? '🏦 CREDIT LIMIT TOP UP — PETANI BESAR'
    : '🏦 CREDIT LIMIT TOP UP REQUEST';

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: headerText, emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Report Number:* ${reportNumber || '—'}` },
        { type: 'mrkdwn', text: `*Request ID:* ${data.requestId}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Requestor:* ${profile?.name || session.senderName} | +${session.phoneNumber}` },
        { type: 'mrkdwn', text: `*Area:* ${profile?.area || '—'}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🕐 Submitted: ${timestamp}` }],
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*FG:* ${data.fgName}` },
        { type: 'mrkdwn', text: `*Farmer:* ${data.farmerName}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Land Parcel Size:* ${data.landParcelSize} Ha${isLargeFarmer ? ' ⚠️ LARGE FARMER' : ''}` },
        { type: 'mrkdwn', text: `*Credit Type:* ${creditType}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Current Limit:* ${formatIDR(data.currentLimit)}` },
        { type: 'mrkdwn', text: `*Requested Top-Up:* ${formatIDR(data.requestedTopUp)}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Reason:*\n${data.reason}` },
    },
  ];

  if (includesAgriInput && data.soNumber) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*SO Number:* ${data.soNumber}` },
    });
  }

  if (isLargeFarmer) {
    blocks.push({ type: 'divider' });
    const largeFarmerFields: any[] = [];
    if (data.farmerIncomeSources) largeFarmerFields.push({ type: 'mrkdwn', text: `*Sumber Pendapatan:*\n${data.farmerIncomeSources}` });
    if (data.businessPotential) largeFarmerFields.push({ type: 'mrkdwn', text: `*Potensi Bisnis:*\n${data.businessPotential}` });
    if (largeFarmerFields.length > 0) {
      blocks.push({ type: 'section', fields: largeFarmerFields });
    }
    const extraFields: any[] = [];
    if (data.collateralType) extraFields.push({ type: 'mrkdwn', text: `*Jenis Jaminan:* ${data.collateralType}` });
    if (data.creditLimitRequestAmount) extraFields.push({ type: 'mrkdwn', text: `*Limit Kredit Diminta:* ${data.creditLimitRequestAmount}` });
    if (extraFields.length > 0) {
      blocks.push({ type: 'section', fields: extraFields });
    }
  }

  blocks.push({ type: 'divider' });

  let docList = '';
  let docCount = 0;
  if (includesAgriInput) {
    docList += `• Signed SO ${data.docSignedSO ? '✅' : '❌'}\n`;
    docList += `• Farmer holding SO ${data.docFarmerHoldingSO ? '✅' : '❌'}\n`;
    if (data.docSignedSO) docCount++;
    if (data.docFarmerHoldingSO) docCount++;
  }
  if (includesMechanization) {
    docList += `• Signed Request Letter ${data.docSignedRequestLetter ? '✅' : '❌'}\n`;
    docList += `• Farmer holding Request Letter ${data.docFarmerHoldingRequestLetter ? '✅' : '❌'}\n`;
    if (data.docSignedRequestLetter) docCount++;
    if (data.docFarmerHoldingRequestLetter) docCount++;
  }
  if (isLargeFarmer) {
    docList += `• Proof of land ownership ${data.docLandOwnership ? '✅' : '❌'}\n`;
    docList += `• Collateral photo ${data.docCollateralPhoto ? '✅' : '❌'}\n`;
    docList += `• Collateral certificate ${data.docCollateralCertificate ? '✅' : '❌'}\n`;
    if (data.docLandOwnership) docCount++;
    if (data.docCollateralPhoto) docCount++;
    if (data.docCollateralCertificate) docCount++;
  }

  const hasSurveyPhoto = !!(data.docSurveyPhotoTM);
  docList += `• Survey photo with TM ${hasSurveyPhoto ? '✅' : '❌'}\n`;
  if (hasSurveyPhoto) docCount++;

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*📎 Documents attached: ${docCount} files*\n${docList}` },
  });

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*⏳ Status: PENDING APPROVAL*` },
  });

  const HARDCODED_OPS_IDS = ['U09RYSST8NQ', 'U0AE7GZRKHU', 'U08D51HMM5L', 'U07QMNFSH18'];
  const mentionOps = process.env.SLACK_MENTION_OPS;
  const rawIds = mentionOps
    ? mentionOps.split(',').map(id => id.trim().replace(/^@/, '')).filter(id => id.startsWith('U'))
    : [];
  const mentionIds = rawIds.length > 0 ? rawIds : HARDCODED_OPS_IDS;
  const mentions = mentionIds.map(id => `<@${id}>`).join(' ');
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${mentions} — Please review this request in the <${process.env.GOOGLE_SHEETS_ID ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_ID}` : 'Google Sheet'}|Credit Limit Sheet>.\n• Update column T (Status) to *APPROVED* or *REJECTED*\n• If rejected, fill column W (Rejection Reason)`,
    },
  });

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${timestamp} | +${session.phoneNumber} | ${profile?.area || '—'}` }],
  });

  return blocks;
}

export async function postCreditLimitToSlack(
  session: BotSession,
  data: Record<string, any>,
  onSlackTs?: (ts: string, channel: string) => void,
  reportNumber?: string
): Promise<any> {
  const blocks = buildCreditLimitBlocks(session, data, reportNumber);
  const fallbackText = `Credit Limit Top Up — ${data.farmerName} — ${session.profile?.name || session.senderName}`;

  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_CREDIT_LIMIT || process.env.SLACK_CHANNEL_ADMIN;

  if (!botToken || !channelId) {
    throw new Error('SLACK_BOT_TOKEN and SLACK_CHANNEL_CREDIT_LIMIT must be configured');
  }

  const res = await axios.post('https://slack.com/api/chat.postMessage', {
    channel: channelId,
    text: fallbackText,
    blocks: blocks,
  }, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  if (!res.data.ok) {
    console.error('[Slack] Web API error for credit limit:', res.data.error);
    throw new Error(`Slack API: ${res.data.error}`);
  }

  const messageTs = res.data.ts;
  const messageChannel = res.data.channel;

  console.log(`[Slack] Posted credit limit request from ${session.profile?.name || session.senderName} (ts: ${messageTs})`);

  if (messageTs && messageChannel && onSlackTs) {
    onSlackTs(messageTs, messageChannel);
  }

  return { ts: messageTs, channel: messageChannel };
}

export async function postSlackThreadReply(
  channelId: string,
  threadTs: string,
  text: string
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return;

  console.log(`[Slack] Posting thread reply to channel=${channelId}, thread_ts="${threadTs}" (type=${typeof threadTs})`);

  const res = await axios.post('https://slack.com/api/chat.postMessage', {
    channel: channelId,
    thread_ts: String(threadTs),
    text: text,
  }, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  if (!res.data.ok) {
    console.error(`[Slack] Thread reply failed: ${res.data.error}`);
  } else {
    console.log(`[Slack] Thread reply posted successfully (ts: ${res.data.ts})`);
  }
}

export async function addSlackReaction(
  channelId: string,
  timestamp: string,
  reaction: string
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return;

  try {
    await axios.post('https://slack.com/api/reactions.add', {
      channel: channelId,
      timestamp: timestamp,
      name: reaction,
    }, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    console.log(`[Slack] Added :${reaction}: to ${timestamp}`);
  } catch (err: any) {
    console.error(`[Slack] Failed to add reaction :${reaction}::`, err.message);
  }
}

export async function getSlackUserName(userId: string): Promise<string> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return userId;

  try {
    const res = await axios.get('https://slack.com/api/users.info', {
      params: { user: userId },
      headers: { Authorization: `Bearer ${botToken}` },
    });
    return res.data.user?.real_name || res.data.user?.name || userId;
  } catch {
    return userId;
  }
}

export async function postToSlack(
  session: BotSession,
  onSlackTs?: (ts: string, channel: string) => void,
  reportNumber?: string
): Promise<any> {
  const blocks =
    session.reportType === 'bug'
      ? buildBugReportBlocks(session, reportNumber)
      : buildAdminRequestBlocks(session, reportNumber);

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
