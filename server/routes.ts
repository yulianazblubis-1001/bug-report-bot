import type { Express } from "express";
import { type Server } from "http";
import crypto from "crypto";
import { handleMessage } from "./bot/router";
import { sessionStore } from "./bot/session";
import { sendMessage } from "./bot/services/wati";
import { getReportLogs, getStats } from "./bot/activityLog";
import { isWhitelisted, getWhitelistCount } from "./bot/whitelist";

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
      console.log("=== WATI PAYLOAD ===");
      console.log(JSON.stringify(req.body, null, 2));
      console.log("===================");
      const body = req.body;

      const phoneNumber = body.waId || body.whatsappNumber || body.from;
      const senderName = body.senderName || body.pushName || body.name || phoneNumber;
      const text = body.text || body.message || body.body || "";
      const messageType = body.type || "text";

      let mediaUrl: string | null = null;
      if (typeof body.data === 'string' && body.data.startsWith('http')) {
        mediaUrl = body.data;
      } else if (body.data?.url) {
        mediaUrl = body.data.url;
      } else if (body.mediaUrl) {
        mediaUrl = body.mediaUrl;
      } else if (body.data?.media?.url) {
        mediaUrl = body.data.media.url;
      }

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
