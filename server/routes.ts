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
      slackBug: !!process.env.SLACK_WEBHOOK_BUG,
      slackAdmin: !!process.env.SLACK_WEBHOOK_ADMIN,
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

  app.post("/webhook", async (req, res) => {
    try {
      const body = req.body;

      const phoneNumber = body.waId || body.whatsappNumber || body.from;
      const senderName = body.senderName || body.pushName || body.name || phoneNumber;
      const text = body.text || body.message || body.body || "";
      const messageType = body.type || "text";

      let mediaUrl: string | null = null;
      if (body.data?.url) {
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

      console.log(`[Webhook] From ${phoneNumber} (${senderName}): type=${messageType}, text="${text}"`);

      res.status(200).json({ status: "received" });

      await handleMessage(phoneNumber, senderName, text, messageType, mediaUrl);
    } catch (err: any) {
      console.error("[Webhook] Error:", err);
      if (!res.headersSent) {
        res.status(200).json({ status: "error", message: err.message });
      }
    }
  });

  app.post("/slack-events", async (req, res) => {
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

        if (!itemTs || !channelId) return;

        const mapping = sessionStore.getSlackMapping(itemTs, channelId);
        if (!mapping) return;

        if (reaction === "done") {
          const name = mapping.senderName || mapping.phoneNumber;
          await sendMessage(
            mapping.phoneNumber,
            `Halo ${name}!\n\nLaporan kamu sudah ditandai *DONE* oleh tim engineering!\n\nMasalahnya sudah diperbaiki. Silakan update app kamu dan coba lagi.\n\nKalau masih bermasalah, ketik *START* untuk buat laporan baru.\n\n_(Your report has been marked as DONE! The issue has been fixed.)_`
          );
          console.log(`[Slack] :done: reaction -> notified ${mapping.phoneNumber}`);
        }

        if (reaction === "solve") {
          const name = mapping.senderName || mapping.phoneNumber;
          await sendMessage(
            mapping.phoneNumber,
            `Halo ${name}!\n\nLaporan kamu sudah ditandai *SOLVED*!\n\nTim sudah menyelesaikan permintaanmu. Silakan cek dan konfirmasi ya.\n\nKalau ada masalah lain, ketik *START* untuk laporan baru.\n\n_(Your report has been marked as SOLVED! Please verify and confirm.)_`
          );
          console.log(`[Slack] :solve: reaction -> notified ${mapping.phoneNumber}`);
        }
      }
    } catch (err: any) {
      console.error("[Slack Events] Error:", err);
      if (!res.headersSent) {
        res.status(200).json({ status: "error" });
      }
    }
  });

  return httpServer;
}
