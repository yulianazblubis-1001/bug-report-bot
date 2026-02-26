/**
 * Slack service — format and post reports to Slack
 */

const axios = require('axios');

/**
 * Get WIB (UTC+7) formatted timestamp
 */
function getWIBTimestamp() {
    const now = new Date();
    return now.toLocaleString('en-GB', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }) + ' WIB';
}

/**
 * Format a translated field: show translated + original if different
 */
function formatTranslatedField(data, fieldName) {
    const translated = data[`${fieldName}_translated`];
    const original = data[`${fieldName}_original`];

    if (!translated && !data[fieldName]) return '—';
    if (!translated) return data[fieldName];

    // If translation is same as original, just show one
    if (translated === original) return translated;

    return `${translated}\n_Original: ${original}_`;
}

/**
 * Build Slack blocks for a Bug Report
 */
function buildBugReportBlocks(session, data) {
    const timestamp = getWIBTimestamp();
    const hasMedia = session.mediaUrls && session.mediaUrls.length > 0;

    const blocks = [
        {
            type: 'header',
            text: { type: 'plain_text', text: '🐛 BUG REPORT | Rize.farm', emoji: true },
        },
        { type: 'divider' },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*👤 Reporter:*\n${session.senderName} | ${session.phoneNumber}` },
                { type: 'mrkdwn', text: `*📱 Platform:*\n${data.platform || '—'} | App ${data.appVersion || '—'}` },
            ],
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*📧 Account:*\n${data.accountInfo || '—'}` },
                { type: 'mrkdwn', text: `*🕐 Submitted:*\n${timestamp}` },
            ],
        },
        { type: 'divider' },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*📋 What Happened:*\n${formatTranslatedField(data, 'whatHappened')}`,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*🔁 Steps to Reproduce:*\n${formatTranslatedField(data, 'stepsToReproduce')}`,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*🔗 Related Info (Task/PG/Farmer/Season):*\n${formatTranslatedField(data, 'relatedInfo')}`,
            },
        },
    ];

    // Add screenshot if available
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
            elements: [{ type: 'mrkdwn', text: '📎 No screenshot attached' }],
        });
    }

    return blocks;
}

/**
 * Build Slack blocks for an Admin Request
 */
function buildAdminRequestBlocks(session, data) {
    const timestamp = getWIBTimestamp();
    const hasMedia = session.mediaUrls && session.mediaUrls.length > 0;

    const urgencyMap = { '1': '🟢 Low', '2': '🟡 Medium', '3': '🔴 High' };
    const urgency = urgencyMap[data.urgency] || data.urgency || '—';

    const blocks = [
        {
            type: 'header',
            text: { type: 'plain_text', text: '🛠️ ADMIN REQUEST | Rize.farm', emoji: true },
        },
        { type: 'divider' },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*👤 Requestor:*\n${session.senderName} | ${session.phoneNumber}` },
                { type: 'mrkdwn', text: `*⚡ Urgency:*\n${urgency}` },
            ],
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*👤 Account Affected:*\n${data.accountAffected || '—'}` },
                { type: 'mrkdwn', text: `*🕐 Submitted:*\n${timestamp}` },
            ],
        },
        { type: 'divider' },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*📋 Request:*\n${formatTranslatedField(data, 'requestDescription')}`,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*💬 Additional Context:*\n${formatTranslatedField(data, 'additionalContext')}`,
            },
        },
    ];

    // Add screenshot if available
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
            elements: [{ type: 'mrkdwn', text: '📎 No screenshot attached' }],
        });
    }

    return blocks;
}

/**
 * Post a report to Slack
 * Returns the Slack message timestamp (for reaction tracking)
 */
async function postToSlack(session, translatedData) {
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

    // Fallback text for notifications
    const fallbackText =
        session.reportType === 'bug'
            ? `🐛 Bug Report from ${session.senderName}`
            : `🛠️ Admin Request from ${session.senderName}`;

    try {
        const res = await axios.post(webhookUrl, {
            text: fallbackText,
            blocks: blocks,
        });
        console.log(`[Slack] Posted ${session.reportType} report from ${session.senderName}`);
        return res.data;
    } catch (err) {
        console.error('[Slack] Error posting:', err.response?.data || err.message);
        throw err;
    }
}

module.exports = { postToSlack };
