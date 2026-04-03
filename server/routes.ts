import type { Express } from "express";
import { type Server } from "http";
import crypto from "crypto";
import { handleMessage } from "./bot/router";
import { sessionStore } from "./bot/session";
import { sendMessage } from "./bot/services/wati";
import { getReportLogs, getStats } from "./bot/activityLog";
import { isWhitelisted, getWhitelistCount, getAllAgronomists, lookupProfile } from "./bot/whitelist";
import * as googleSheets from "./bot/services/google-sheets";
import * as googleDrive from "./bot/services/google-drive";
import { postSlackThreadReply, getSlackUserName, addSlackReaction, postCreditLimitToSlack, buildCreditLimitBlocks } from "./bot/services/slack";
import { addReportLog } from "./bot/activityLog";
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';

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

        const mapping = await sessionStore.getSlackMapping(itemTs, channelId);
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

    } catch (err: any) {
      console.error("[Slack Events] Error:", err);
      if (!res.headersSent) {
        res.status(200).json({ status: "error" });
      }
    }
  }

  app.post("/slack-events", slackEventsHandler);
  app.post("/api/bot/slack-events", slackEventsHandler);

  async function sheetUpdateHandler(req: any, res: any) {
    try {
      const sheetSecret = process.env.SHEET_WEBHOOK_SECRET;
      if (sheetSecret) {
        const authHeader = req.headers['x-webhook-secret'] || req.query?.secret;
        if (authHeader !== sheetSecret) {
          console.warn('[Sheet Update] Unauthorized request — invalid secret');
          return res.status(401).json({ error: "Unauthorized" });
        }
      }

      const body = req.body;
      const { requestId, status, reviewedBy, rejectionReason, reporterPhone, reporterName, farmerName } = body;
      const slackTs = body.slackTs ? String(body.slackTs) : '';

      console.log(`[Sheet Update] Received: requestId=${requestId}, status=${status}, reviewedBy=${reviewedBy}, slackTs=${slackTs || '(empty)'}, channel=${process.env.SLACK_CHANNEL_CREDIT_LIMIT || process.env.SLACK_CHANNEL_ADMIN || '(none)'}, reporterPhone=${reporterPhone || '(empty)'}`);

      if (!requestId || !status) {
        return res.status(400).json({ error: "Missing requestId or status" });
      }

      res.status(200).json({ status: "received" });

      const creditLimitChannel = process.env.SLACK_CHANNEL_CREDIT_LIMIT || process.env.SLACK_CHANNEL_ADMIN;

      if (status === 'APPROVED' || status === 'REJECTED') {
        const reason = status === 'REJECTED' ? (rejectionReason || 'No reason provided') : '';

        if (creditLimitChannel) {
          if (slackTs) {
            console.log(`[Sheet Update] Using slackTs="${slackTs}" for Slack thread reply`);
            const emoji = status === 'APPROVED' ? 'white_check_mark' : 'x';
            try {
              await addSlackReaction(creditLimitChannel, slackTs, emoji);
            } catch (reactionErr: any) {
              console.error(`[Sheet Update] Reaction failed: ${reactionErr.message}`);
            }

            const replyText = status === 'APPROVED'
              ? `✅ Approved by ${reviewedBy || 'Ops'}. Engineers — please process this credit limit top-up. React with ✅ when done.`
              : `❌ Rejected by ${reviewedBy || 'Ops'}. Reason: ${reason}\nWhatsApp notification sent to ${reporterName || 'reporter'}.`;

            try {
              await postSlackThreadReply(creditLimitChannel, slackTs, replyText);
            } catch (replyErr: any) {
              console.error(`[Sheet Update] Thread reply failed: ${replyErr.message}`);
            }
          } else {
            console.warn(`[Sheet Update] No slackTs — cannot add reaction or thread reply`);
          }
        }

        if (status === 'REJECTED' && reporterPhone) {
          await sendMessage(
            reporterPhone,
            `❌ Halo ${reporterName || ''}, permintaan credit limit top up untuk ${farmerName || 'farmer'} ditolak.\n\nAlasan: ${reason}\n\nKamu bisa submit ulang dengan ketik *START*.\n\n_(Your credit limit top-up request for ${farmerName || 'farmer'} was rejected. Reason: ${reason}. Type START to resubmit.)_`
          );
        }

        if (status === 'APPROVED' && reporterPhone) {
          await sendMessage(
            reporterPhone,
            `✅ Halo ${reporterName || ''}, permintaan credit limit top up untuk ${farmerName || 'farmer'} sudah di-approve oleh ${reviewedBy || 'Ops'}.\n\nTim engineering akan segera memprosesnya.\n\n_(Your credit limit top-up request for ${farmerName || 'farmer'} has been approved by ${reviewedBy || 'Ops'}.)_`
          );
        }

        console.log(`[Sheet Update] ${status} ${requestId} by ${reviewedBy}${reason ? ': ' + reason : ''}`);
      }
    } catch (err: any) {
      console.error("[Sheet Update] Error:", err.message);
      if (!res.headersSent) {
        res.status(200).json({ status: "error", message: err.message });
      }
    }
  }

  app.post("/sheet-update", sheetUpdateHandler);
  app.post("/api/bot/sheet-update", sheetUpdateHandler);

  // ─── Credit Limit Form API ───────────────────────────────────────

  // GET agronomist list for dropdown
  app.get("/api/agronomists", (_req, res) => {
    const list = getAllAgronomists();
    res.json(list);
  });

  // File upload with multer (memory storage)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  });

  // POST credit limit form submission
  app.post("/api/credit-limit/submit", upload.fields([
    { name: 'docSignedSO', maxCount: 1 },
    { name: 'docFarmerHolding', maxCount: 1 },
    { name: 'docLandOwnership', maxCount: 1 },
    { name: 'docJaminan', maxCount: 1 },
    { name: 'docSurveyPhotoTM', maxCount: 1 },
  ]), async (req: any, res: any) => {
    try {
      const body = req.body;
      const files = req.files || {};

      // Validate required fields
      const required = ['reporterPhone', 'fgName', 'farmerName', 'landSizeVerified', 'currentLimit', 'requestedTopUp', 'creditType', 'reason'];
      const missing = required.filter(f => !body[f]);
      if (missing.length > 0) {
        return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
      }

      // Look up reporter profile
      const profile = lookupProfile(body.reporterPhone);
      if (!profile) {
        return res.status(403).json({ error: 'Phone number not in whitelist' });
      }

      const requestId = uuidv4().substring(0, 8).toUpperCase();
      const timestamp = getWIBTimestamp();
      const isLargeFarmer = body.creditLimitType === 'largeFarmer';
      const creditType = body.creditType || '';

      // Upload documents to Google Drive
      const driveUrls: Record<string, string> = {};
      const docFields = ['docSignedSO', 'docFarmerHolding', 'docLandOwnership', 'docJaminan', 'docSurveyPhotoTM'];

      for (const fieldName of docFields) {
        const fileArr = files[fieldName];
        if (fileArr && fileArr.length > 0) {
          const file = fileArr[0];
          try {
            const ext = file.originalname.split('.').pop() || 'jpg';
            const fileName = `${requestId}_${fieldName}.${ext}`;
            const driveUrl = await googleDrive.uploadToDrive(file.buffer, fileName, file.mimetype);
            driveUrls[fieldName] = driveUrl;
          } catch (err: any) {
            console.error(`[Form] Failed to upload ${fieldName}:`, err.message);
          }
        }
      }

      // Build Slack data
      const slackData: Record<string, any> = {
        requestId,
        timestamp,
        fgName: body.fgName,
        farmerName: body.farmerName,
        landParcelSize: body.landSizeVerified,
        currentLimit: body.currentLimit,
        requestedTopUp: body.requestedTopUp,
        creditType: body.creditType,
        reason: body.reason,
        soNumber: body.soNumber || '',
        creditLimitType: body.creditLimitType || 'standard',
        farmerIncomeSources: body.farmerIncomeSources || '',
        businessPotential: body.businessPotential || '',
        collateralType: body.collateralType || '',
        creditLimitRequestAmount: body.creditLimitRequestAmount || '',
        docSignedSO: driveUrls.docSignedSO || '',
        docFarmerHoldingSO: driveUrls.docSignedSO || '',
        docSignedRequestLetter: driveUrls.docSignedSO || '',
        docFarmerHoldingRequestLetter: driveUrls.docFarmerHolding || '',
        docLandOwnership: driveUrls.docLandOwnership || '',
        docCollateralPhoto: driveUrls.docJaminan || '',
        docCollateralCertificate: '',
        docSurveyPhotoTM: driveUrls.docSurveyPhotoTM || '',
      };

      // Build a minimal session object for Slack posting
      const fakeSession: any = {
        phoneNumber: body.reporterPhone,
        senderName: profile.name,
        profile,
        reportType: 'creditTopUp',
        creditLimitType: body.creditLimitType || 'standard',
        mediaUrls: [],
      };

      // Post to Slack
      const slackResult = await postCreditLimitToSlack(fakeSession, slackData, (ts, channel) => {
        sessionStore.storeSlackMapping(ts, channel, {
          phoneNumber: body.reporterPhone,
          senderName: profile.name,
          reportType: 'creditTopUp',
          requestId,
          farmerName: body.farmerName,
        });
      });

      // Build income/collateral for sheets
      let farmerIncomeAndBusiness = '';
      if (isLargeFarmer) {
        const parts: string[] = [];
        if (body.farmerIncomeSources) parts.push(body.farmerIncomeSources);
        if (body.businessPotential) parts.push(`Potensi Bisnis: ${body.businessPotential}`);
        farmerIncomeAndBusiness = parts.join('; ');
      }

      let collateralInfo = '';
      if (isLargeFarmer && body.collateralType) {
        collateralInfo = body.collateralType;
        if (body.creditLimitRequestAmount) {
          collateralInfo += ` - ${body.creditLimitRequestAmount}`;
        }
      }

      // Write to Google Sheets
      const sheetRow: googleSheets.CreditLimitRow = {
        timestamp,
        requestId,
        reporterName: profile.name,
        reporterPhone: body.reporterPhone,
        fgName: body.fgName,
        farmerName: body.farmerName,
        landSizeVerified: body.landSizeVerified,
        currentLimit: body.currentLimit,
        requestedTopUp: body.requestedTopUp,
        creditType: body.creditType,
        reason: body.reason,
        soNumber: body.soNumber || '',
        farmerIncomeAndBusiness,
        collateralInfo,
        docSignedSO: driveUrls.docSignedSO || driveUrls.docFarmerHolding ? driveUrls.docSignedSO || '' : '',
        docFarmerHolding: driveUrls.docFarmerHolding || '',
        docLandOwnership: driveUrls.docLandOwnership || '',
        docJaminan: driveUrls.docJaminan || '',
        docSurveyPhotoTM: driveUrls.docSurveyPhotoTM || '',
        status: 'PENDING',
        reviewedBy: '',
        reviewDate: '',
        rejectionReason: '',
        slackMessageTs: slackResult.ts || '',
      };

      await googleSheets.appendRequest(sheetRow);

      // Log the activity
      addReportLog({
        type: 'creditTopUp',
        reporter: profile.name,
        phoneNumber: body.reporterPhone,
        summary: `[FORM] Credit Limit Top Up — ${body.farmerName} — ${body.creditType}`,
        status: 'submitted',
      });

      // Send WhatsApp notification to reporter
      try {
        await sendMessage(
          body.reporterPhone,
          `✅ Halo ${profile.name}! Permintaan credit limit top up untuk ${body.farmerName} sudah dikirim via form.\n\nRequest ID: *${requestId}*\nTim Ops Excellence akan review permintaan kamu.\n\nKamu akan mendapat notifikasi saat di-approve atau di-reject.\n\n_(Credit Limit Top Up submitted via form. Request ID: ${requestId}.)_`
        );
      } catch (waErr: any) {
        console.error('[Form] WhatsApp notification failed:', waErr.message);
      }

      res.json({
        success: true,
        requestId,
        message: `Credit Limit Top Up submitted. Request ID: ${requestId}`,
      });
    } catch (err: any) {
      console.error('[Form] Submit error:', err.message);
      res.status(500).json({ error: 'Failed to submit. Please try again.' });
    }
  });

  return httpServer;
}

function getWIBTimestamp(): string {
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
