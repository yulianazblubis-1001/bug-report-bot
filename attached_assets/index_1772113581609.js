/**
 * Rize.farm WhatsApp → Slack Bug Reporter
 * Express server entry point
 */

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { handleMessage } = require('./router');
const session = require('./session');
const wati = require('./services/wati');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());
// Parse raw body for Slack signature verification
app.use('/slack-events', express.raw({ type: 'application/json' }));

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Rize.farm WhatsApp Reporter',
        uptime: process.uptime(),
    });
});

/**
 * WATI Webhook — receives incoming WhatsApp messages
 * 
 * WATI sends a POST with message data when someone messages your number
 */
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;

        // Extract fields from WATI payload
        // WATI payloads can vary — handle common structures
        const phoneNumber = body.waId || body.whatsappNumber || body.from;
        const senderName = body.senderName || body.pushName || body.name || phoneNumber;
        const text = body.text || body.message || body.body || '';
        const messageType = body.type || 'text'; // text, image, video, document

        // Media URL extraction (WATI puts media URLs in different places depending on type)
        let mediaUrl = null;
        if (body.data && body.data.url) {
            mediaUrl = body.data.url;
        } else if (body.mediaUrl) {
            mediaUrl = body.mediaUrl;
        } else if (body.data && body.data.media && body.data.media.url) {
            mediaUrl = body.data.media.url;
        }

        if (!phoneNumber) {
            console.warn('[Webhook] No phone number in payload:', JSON.stringify(body).substring(0, 200));
            return res.status(200).json({ status: 'ignored', reason: 'no phone number' });
        }

        console.log(`[Webhook] From ${phoneNumber} (${senderName}): type=${messageType}, text="${text}"`);

        // Process the message asynchronously
        // Respond to WATI immediately to avoid timeout
        res.status(200).json({ status: 'received' });

        await handleMessage(phoneNumber, senderName, text, messageType, mediaUrl);

    } catch (err) {
        console.error('[Webhook] Error:', err);
        // Always respond 200 to WATI to avoid retries
        if (!res.headersSent) {
            res.status(200).json({ status: 'error', message: err.message });
        }
    }
});

/**
 * Slack Events Webhook — handles reaction_added events
 * 
 * When someone reacts with :done: or :solve: on a report,
 * this sends a WhatsApp message back to the original reporter.
 */
app.post('/slack-events', async (req, res) => {
    try {
        let body;
        if (Buffer.isBuffer(req.body)) {
            body = JSON.parse(req.body.toString());
        } else {
            body = req.body;
        }

        // Slack URL verification challenge
        if (body.type === 'url_verification') {
            return res.json({ challenge: body.challenge });
        }

        // Verify Slack signature (optional but recommended)
        if (process.env.SLACK_SIGNING_SECRET && req.headers['x-slack-signature']) {
            const timestamp = req.headers['x-slack-request-timestamp'];
            const sigBase = `v0:${timestamp}:${Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body)}`;
            const mySignature = 'v0=' + crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update(sigBase).digest('hex');

            if (mySignature !== req.headers['x-slack-signature']) {
                console.warn('[Slack] Invalid signature');
                return res.status(401).json({ error: 'invalid signature' });
            }
        }

        res.status(200).json({ status: 'ok' });

        // Handle reaction_added events
        if (body.event && body.event.type === 'reaction_added') {
            const reaction = body.event.reaction;
            const itemTs = body.event.item?.ts;
            const channelId = body.event.item?.channel;

            if (!itemTs || !channelId) return;

            // Check if this reaction is on one of our reports
            const mapping = session.getSlackMapping(itemTs, channelId);
            if (!mapping) return;

            if (reaction === 'done') {
                const name = mapping.senderName || mapping.phoneNumber;
                await wati.sendMessage(mapping.phoneNumber,
                    `✅ Halo ${name}!\n\nLaporan kamu sudah ditandai *DONE* oleh tim engineering! 🎉\n\nMasalahnya sudah diperbaiki. Silakan update app kamu dan coba lagi. 🙏\n\nKalau masih bermasalah, ketik *START* untuk buat laporan baru.\n\n_(Your report has been marked as DONE! The issue has been fixed. Please update and try again.)_`
                );
                console.log(`[Slack] :done: reaction → notified ${mapping.phoneNumber}`);
            }

            if (reaction === 'solve') {
                const name = mapping.senderName || mapping.phoneNumber;
                await wati.sendMessage(mapping.phoneNumber,
                    `🟢 Halo ${name}!\n\nLaporan kamu sudah ditandai *SOLVED*! ✨\n\nTim sudah menyelesaikan permintaanmu. Silakan cek dan konfirmasi ya. 🙏\n\nKalau ada masalah lain, ketik *START* untuk laporan baru.\n\n_(Your report has been marked as SOLVED! Please verify and confirm.)_`
                );
                console.log(`[Slack] :solve: reaction → notified ${mapping.phoneNumber}`);
            }
        }

    } catch (err) {
        console.error('[Slack Events] Error:', err);
        if (!res.headersSent) {
            res.status(200).json({ status: 'error' });
        }
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Rize.farm WhatsApp Reporter running on port ${PORT}`);
    console.log(`📡 WATI Webhook: POST /webhook`);
    console.log(`📡 Slack Events: POST /slack-events`);
    console.log(`💚 Health check: GET /\n`);

    // Validation
    if (!process.env.WATI_API_ENDPOINT) console.warn('⚠️  WATI_API_ENDPOINT not set');
    if (!process.env.WATI_TOKEN) console.warn('⚠️  WATI_TOKEN not set');
    if (!process.env.SLACK_WEBHOOK_BUG) console.warn('⚠️  SLACK_WEBHOOK_BUG not set');
    if (!process.env.SLACK_WEBHOOK_ADMIN) console.warn('⚠️  SLACK_WEBHOOK_ADMIN not set');
    if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY not set (translation disabled)');
});
