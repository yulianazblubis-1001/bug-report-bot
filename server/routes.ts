import type { Express } from "express";
import { type Server } from "http";
import crypto from "crypto";
import { handleMessage } from "./bot/router";
import { sessionStore } from "./bot/session";
import { sendMessage } from "./bot/services/wati";
import { getReportLogs, getStats } from "./bot/activityLog";
import { isWhitelisted, getWhitelistCount } from "./bot/whitelist";
import * as googleSheets from "./bot/services/google-sheets";
import { postSlackThreadReply, getSlackUserName } from "./bot/services/slack";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/bot/status", (_req, res) => {
    const configStatus = {
      wati: !!(process.env.WATI_API_ENDPOINT && process.env.WATI_TOKEN),
      slackBug: !!(process.env.SLACK_CHANNEL_BUG || process.env.SLACK_WEBHOOK_BUG),
      slackAdmin: !!(process.env.SLACK_CHANNEL_ADMIN || process.env.SLACK_WEBHOOK_ADMIN),
      slackBot: !!process.env.SLACK_BOT_TOKEN,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      slackSigning: !!process.env.SLACK_SIGNING_SECRET,
    };

    const whitelistNumbers = getWhitelistCount();

    const allConfigured = Object.values(configStatus).every(Boolean);

    res.json({
      status: allConfigured ? "ready" : "partial",
      activeSessions: sessionStore.getActiveSessions(),
      uptime: process.uptime(),
      config: configStatus,
      stats: getStats(),
      whitelist: {
        enabled: whitelistNumbers > 0,
        count: whitelistNumbers,
      },
    });
  });

  app.get("/api/bot/logs", (_req, res) => {
    res.json(getReportLogs());
  });

  app.get("/ping", (_req, res) => {
    res.json({ status: "pong", timestamp: Date.now() });
  });

  async function webhookHandler(req: any, res: any) {
    try {
      const body = req.body;
      const messageType = body.type || "text";

      if (messageType === 'image' || messageType === 'video' || messageType === 'document') {
        console.log("=== MEDIA PAYLOAD ===");
        console.log(JSON.stringify(body, null, 2));
        console.log("===================");
      } else {
        console.log(`[Webhook] Incoming: type=${messageType}, text="${(body.text || body.message || '').substring(0, 100)}"`);
      }

      const phoneNumber = body.waId || body.whatsappNumber || body.from;
      const senderName = body.senderName || body.pushName || body.name || phoneNumber;
      const text = body.text || body.message || body.body || "";

      let mediaUrl: string | null = null;
      if (typeof body.data === 'string' && body.data.startsWith('http')) {
        mediaUrl = body.data;
      } else if (body.data?.url) {
        mediaUrl = body.data.url;
      } else if (body.mediaUrl) {
        mediaUrl = body.mediaUrl;
      } else if (body.data?.media?.url) {
        mediaUrl = body.data.media.url;
      } else if (body.attachment?.url) {
        mediaUrl = body.attachment.url;
      }

      console.log(`[Webhook] EXTRACTED MEDIA URL: ${mediaUrl}`);

      if (!phoneNumber) {
        console.warn("[Webhook] No phone number in payload:", JSON.stringify(body).substring(0, 200));
        return res.status(200).json({ status: "ignored", reason: "no phone number" });
      }

      console.log(`[Webhook] From ${phoneNumber} (${senderName}): type=${messageType}, text="${text}", mediaUrl=${mediaUrl}`);

      res.status(200).json({ status: "received" });

      await handleMessage(phoneNumber, senderName, text, messageType, mediaUrl);
    } catch (err: any) {
      console.error("[Webhook] Error:", err);
      if (!res.headersSent) {
        res.status(200).json({ status: "error", message: err.message });
      }
    }
  }

  function webhookGetHandler(_req: any, res: any) {
    res.json({ status: "webhook endpoint active", method: "Use POST" });
  }

  app.post("/webhook", webhookHandler);
  app.get("/webhook", webhookGetHandler);
  app.post("/api/bot/webhook", webhookHandler);
  app.get("/api/bot/webhook", webhookGetHandler);

  async function slackEventsHandler(req: any, res: any) {
    try {
      let body: any;
      if (Buffer.isBuffer(req.body)) {
        body = JSON.parse(req.body.toString());
      } else {
        body = req.body;
      }

      if (body.type === "url_verification") {
        return res.json({ challenge: body.challenge });
      }

      if (process.env.SLACK_SIGNING_SECRET && req.headers["x-slack-signature"]) {
        const timestamp = req.headers["x-slack-request-timestamp"] as string;
        const rawBody = (req as any).rawBody;
        const sigBase = `v0:${timestamp}:${rawBody ? rawBody.toString() : JSON.stringify(body)}`;
        const mySignature =
          "v0=" +
          crypto
            .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
            .update(sigBase)
            .digest("hex");

        if (mySignature !== req.headers["x-slack-signature"]) {
          console.warn("[Slack] Invalid signature");
          return res.status(401).json({ error: "invalid signature" });
        }
      }

      res.status(200).json({ status: "ok" });

      if (body.event?.type === "reaction_added") {
        const reaction = body.event.reaction;
        const itemTs = body.event.item?.ts;
        const channelId = body.event.item?.channel;

        console.log(`[Slack Events] reaction_added: emoji="${reaction}" ts=${itemTs} channel=${channelId}`);

        if (!itemTs || !channelId) return;

        const mapping = sessionStore.getSlackMapping(itemTs, channelId);
        if (!mapping) {
          console.log(`[Slack Events] No mapping found for ${channelId}:${itemTs}`);
          return;
        }

        console.log(`[Slack Events] Found mapping for ${mapping.senderName} (${mapping.phoneNumber})`);

        if (mapping.reportType === 'creditTopUp') {
          if (reaction === "white_check_mark" || reaction === "done") {
            try {
              if (mapping.requestId) {
                await googleSheets.updateStatus(mapping.requestId, 'RESOLVED', 'Engineer', '');
              }
              await sendMessage(
                mapping.phoneNumber,
                `✅ Halo ${mapping.senderName}! Credit limit top up untuk ${mapping.farmerName || 'farmer'} sudah diproses! Silakan cek di app. 🙏\n\n_(Your credit limit top-up for ${mapping.farmerName || 'farmer'} has been processed! Please check in the app.)_`
              );
              await postSlackThreadReply(channelId, itemTs, `✅ Credit limit top-up has been processed. WhatsApp notification sent to ${mapping.senderName}.`);
              console.log(`[Slack Events] Credit limit resolved for ${mapping.phoneNumber}`);
            } catch (err: any) {
              console.error('[Slack Events] Error handling credit limit resolution:', err.message);
            }
          }
          return;
        }

        if (reaction === "done") {
          await sendMessage(
            mapping.phoneNumber,
            `Halo ${mapping.senderName}! Laporan kamu sudah ditandai DONE oleh tim. Masalahnya sudah diperbaiki, silakan coba lagi.\n\n_(Your report has been marked DONE. The issue has been fixed, please try again.)_`
          );
          console.log(`[Slack Events] :done: -> notified ${mapping.phoneNumber}`);
        }

        if (reaction === "solve" || reaction === "solved") {
          await sendMessage(
            mapping.phoneNumber,
            `Halo ${mapping.senderName}! Laporan kamu sudah SOLVED. Silakan cek ya.\n\n_(Your report has been SOLVED. Please check.)_`
          );
          console.log(`[Slack Events] :solve: -> notified ${mapping.phoneNumber}`);
        }
      }

      if (body.event?.type === "message" && body.event.thread_ts && !body.event.bot_id) {
        const threadTs = body.event.thread_ts;
        const channelId = body.event.channel;
        const messageText = (body.event.text || '').trim();
        const userId = body.event.user;

        console.log(`[Slack Events] Thread reply in ${channelId}: "${messageText.substring(0, 80)}" by ${userId}`);

        const creditLimitChannel = process.env.SLACK_CHANNEL_CREDIT_LIMIT || process.env.SLACK_CHANNEL_ADMIN;
        if (channelId !== creditLimitChannel) return;

        const mapping = sessionStore.getSlackMapping(threadTs, channelId);
        if (!mapping || mapping.reportType !== 'creditTopUp') {
          console.log(`[Slack Events] No credit limit mapping for thread ${threadTs}`);
          return;
        }

        const upperMsg = messageText.toUpperCase();
        const userName = await getSlackUserName(userId);

        if (upperMsg === 'APPROVED' || upperMsg.startsWith('APPROVED')) {
          console.log(`[Slack Events] Credit limit APPROVED by ${userName} for ${mapping.requestId}`);

          try {
            if (mapping.requestId) {
              await googleSheets.updateStatus(mapping.requestId, 'APPROVED', userName, '');
            }
            await postSlackThreadReply(
              channelId,
              threadTs,
              `✅ Request approved by ${userName}. Engineers — please process this credit limit top-up. React with ✅ when done.`
            );
            console.log(`[Slack Events] Approval posted for ${mapping.requestId}`);
          } catch (err: any) {
            console.error('[Slack Events] Error processing approval:', err.message);
          }
        }

        if (upperMsg.startsWith('REJECTED') || upperMsg.startsWith('REJECT')) {
          const reason = messageText.replace(/^REJECTED?\s*/i, '').trim() || 'No reason provided';

          console.log(`[Slack Events] Credit limit REJECTED by ${userName} for ${mapping.requestId}: ${reason}`);

          try {
            if (mapping.requestId) {
              await googleSheets.updateStatus(mapping.requestId, 'REJECTED', userName, reason);
            }

            await sendMessage(
              mapping.phoneNumber,
              `❌ Halo ${mapping.senderName}, permintaan credit limit top up untuk ${mapping.farmerName || 'farmer'} ditolak.\n\nAlasan: ${reason}\n\nKamu bisa submit ulang dengan ketik *START*.\n\n_(Your credit limit top-up request for ${mapping.farmerName || 'farmer'} was rejected. Reason: ${reason}. Type START to resubmit.)_`
            );

            await postSlackThreadReply(
              channelId,
              threadTs,
              `❌ Request rejected by ${userName}. Reason: ${reason}\nWhatsApp notification sent to ${mapping.senderName}.`
            );

            console.log(`[Slack Events] Rejection processed for ${mapping.requestId}`);
          } catch (err: any) {
            console.error('[Slack Events] Error processing rejection:', err.message);
          }
        }
      }
    } catch (err: any) {
      console.error("[Slack Events] Error:", err);
      if (!res.headersSent) {
        res.status(200).json({ status: "error" });
      }
    }
  }

  app.post("/slack-events", slackEventsHandler);
  app.post("/api/bot/slack-events", slackEventsHandler);

  return httpServer;
}
