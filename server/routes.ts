import type { Express } from "express";
import { type Server } from "http";
import crypto from "crypto";
import { handleMessage } from "./bot/router";
import { sessionStore } from "./bot/session";
import { sendMessage, sendTemplateMessage } from "./bot/services/wati";
import { getReportLogs, getStats } from "./bot/activityLog";
import { isWhitelisted, getWhitelistCount, getAllAgronomists, lookupProfile } from "./bot/whitelist";
import * as googleSheets from "./bot/services/google-sheets";
import * as googleDrive from "./bot/services/google-drive";
import { postSlackThreadReply, getSlackUserName, addSlackReaction, postCreditLimitToSlack, buildCreditLimitBlocks } from "./bot/services/slack";
import { addReportLog } from "./bot/activityLog";
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import * as reportRegistry from './bot/services/reportRegistry';
import { getNextReportNumber } from './bot/services/reportCounter';

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
    // Acknowledge immediately — WATI requires 200 within a few seconds
    // or it marks the webhook as failing and will auto-disable it
    res.status(200).json({ status: "received" });

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
        return;
      }

      console.log(`[Webhook] From ${phoneNumber} (${senderName}): type=${messageType}, text="${text}", mediaUrl=${mediaUrl}`);

      await handleMessage(phoneNumber, senderName, text, messageType, mediaUrl);
    } catch (err: any) {
      console.error("[Webhook] Error:", err);
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

        // Primary lookup by channelId:ts key; fall back to ts-only search
        // to handle any channel ID mismatch between stored and event-delivered values
        let mapping = await sessionStore.getSlackMapping(itemTs, channelId);
        if (!mapping) {
          console.log(`[Slack Events] Primary lookup miss for ${channelId}:${itemTs} — trying ts-only fallback`);
          mapping = await sessionStore.findSlackMappingByTs(itemTs);
        }
        if (!mapping) {
          console.log(`[Slack Events] No mapping found for ts=${itemTs} in any channel — ignoring`);
          return;
        }

        console.log(`[Slack Events] Found mapping for ${mapping.senderName} (${mapping.phoneNumber}) type=${mapping.reportType}`);

        // Look up report number from durable registry first, fall back to DB mapping
        let registryRecord: Awaited<ReturnType<typeof reportRegistry.get>> = null;
        try {
          registryRecord = await reportRegistry.get(itemTs);
        } catch (regErr: any) {
          console.warn(`[Slack Events] Registry lookup failed: ${regErr.message}`);
        }

        const reportNumber = registryRecord?.reportNumber || mapping.reportNumber || '';
        const rnTextID = reportNumber ? ` dengan Report Number ${reportNumber}` : '';
        const rnSubjectEN = reportNumber ? `Your Report Number ${reportNumber}` : 'Your report';

        // Duplicate-resolution guard — skip if already marked DONE in registry
        if (registryRecord?.status === 'DONE') {
          console.log(`[Slack Events] Already DONE in registry for ts=${itemTs} — skipping WA notification`);
          return;
        }

        // ── Credit Limit Top Up ──────────────────────────────────────────────────
        if (mapping.reportType === 'creditTopUp') {
          if (reaction === "done" || reaction === "white_check_mark") {
            try {
              if (mapping.requestId) {
                await googleSheets.updateStatus(mapping.requestId, 'RESOLVED', 'Engineer', '');
              }
              try {
                await sendMessage(
                  mapping.phoneNumber,
                  `✅ Halo ${mapping.senderName}! Credit Limit Top Up${rnTextID} sudah diproses oleh tim.\n\nHi ${mapping.senderName}! ${rnSubjectEN} has been processed by the team.`
                );
                await postSlackThreadReply(channelId, itemTs, `✅ Credit limit top-up has been processed. WhatsApp notification sent to ${mapping.senderName}.`);
                await reportRegistry.markResolved(itemTs);
                console.log(`[EMOJI_REPLY] reportNumber: ${reportNumber} emoji: ${reaction} reportType: creditTopUp replySent: resolved`);
              } catch (watiErr: any) {
                const reason = watiErr.watiData?.message || watiErr.message || 'unknown';
                console.error(`[EMOJI_REPLY] WA send failed for ${mapping.phoneNumber}: ${reason}`);
                await postSlackThreadReply(channelId, itemTs, `⚠️ WhatsApp notification to ${mapping.senderName} failed (${reason}). Please notify them manually.`);
              }
            } catch (err: any) {
              console.error('[Slack Events] Error handling credit limit resolution:', err.message);
            }
          }
          return;
        }

        // ── Bug Report & Admin Request ───────────────────────────────────────────
        const RESOLVED_EMOJIS = ['done', 'white_check_mark', 'solve', 'solved'];
        const REJECTED_EMOJIS = ['x', 'notabug-1'];

        if (RESOLVED_EMOJIS.includes(reaction)) {
          let waMsg: string;
          if (mapping.reportType === 'admin') {
            waMsg =
              `Halo ${mapping.senderName}! Request kamu${rnTextID} sudah ditandai DONE oleh tim. Permintaanmu sudah diproses.\n\n` +
              `Hi ${mapping.senderName}! ${rnSubjectEN} has been marked DONE by the team. Your request has been processed.`;
          } else {
            waMsg =
              `Halo ${mapping.senderName}! Laporan kamu${rnTextID} sudah ditandai DONE oleh tim. Masalahnya sudah diperbaiki, silakan coba lagi.\n\n` +
              `Hi ${mapping.senderName}! ${rnSubjectEN} has been marked DONE by the team. The issue has been fixed, please try again.`;
          }
          try {
            await sendMessage(mapping.phoneNumber, waMsg);
            await reportRegistry.markResolved(itemTs);
            console.log(`[EMOJI_REPLY] reportNumber: ${reportNumber} emoji: ${reaction} reportType: ${mapping.reportType} replySent: resolved`);
          } catch (watiErr: any) {
            const watiMsg = watiErr.watiData?.message || watiErr.message || '';
            const isExpired = watiMsg.toLowerCase().includes('expired') || watiMsg.toLowerCase().includes('closed');
            if (isExpired) {
              console.log(`[EMOJI_REPLY] Ticket expired for ${mapping.phoneNumber} — falling back to template message`);
              try {
                await sendTemplateMessage(mapping.phoneNumber, 'resolved_bug_admreq_after_one_day', [
                  { name: 'ja_name', value: mapping.senderName },
                  { name: 'report_number', value: reportNumber || '—' },
                ]);
                await reportRegistry.markResolved(itemTs);
                console.log(`[EMOJI_REPLY] reportNumber: ${reportNumber} emoji: ${reaction} reportType: ${mapping.reportType} replySent: resolved_via_template`);
              } catch (tmplErr: any) {
                const tmplReason = (tmplErr as any).watiData?.message || (tmplErr as Error).message || 'unknown';
                console.error(`[EMOJI_REPLY] Template also failed for ${mapping.phoneNumber}: ${tmplReason}`);
                await postSlackThreadReply(channelId, itemTs, `⚠️ WhatsApp notification to ${mapping.senderName} failed — session expired and template also failed (${tmplReason}). Please notify them manually.`);
              }
            } else {
              console.error(`[EMOJI_REPLY] WA send failed for ${mapping.phoneNumber}: ${watiMsg}`);
              await postSlackThreadReply(channelId, itemTs, `⚠️ WhatsApp notification to ${mapping.senderName} failed (${watiMsg}). Please notify them manually.`);
            }
          }
          return;
        }

        if (REJECTED_EMOJIS.includes(reaction)) {
          let waMsg: string;
          if (mapping.reportType === 'admin') {
            waMsg =
              `Halo ${mapping.senderName}! Request kamu${rnTextID} ditolak oleh tim.\n\n` +
              `Hi ${mapping.senderName}! ${rnSubjectEN} has been rejected by the team.`;
          } else {
            waMsg =
              `Halo ${mapping.senderName}! Laporan kamu${rnTextID} ditandai sebagai BUKAN BUG oleh tim. ` +
              `Silakan cek kembali langkah-langkahnya, pastikan semua field wajib sudah diisi, atau hubungi tim produk via WhatsApp support channel.\n\n` +
              `Hi ${mapping.senderName}! ${rnSubjectEN} has been marked as NOT A BUG by the team. ` +
              `Please retry, make sure all mandatory fields are filled, or contact the product team via the WhatsApp support channel.`;
          }
          try {
            await sendMessage(mapping.phoneNumber, waMsg);
            console.log(`[EMOJI_REPLY] reportNumber: ${reportNumber} emoji: ${reaction} reportType: ${mapping.reportType} replySent: rejected`);
          } catch (watiErr: any) {
            const reason = watiErr.watiData?.message || watiErr.message || 'unknown';
            console.error(`[EMOJI_REPLY] WA send failed for ${mapping.phoneNumber}: ${reason}`);
            await postSlackThreadReply(channelId, itemTs, `⚠️ WhatsApp notification to ${mapping.senderName} failed (${reason}). Please notify them manually.`);
          }
          return;
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
              ? `✅ Approved by ${reviewedBy || 'Ops'}. Engineers — please process this credit limit top-up. React with :done: when processed.`
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

        let sheetReportNumber = '';
        try {
          const rowData = await googleSheets.findByRequestId(requestId);
          sheetReportNumber = rowData?.data?.reportNumber || '';
        } catch {}
        const rnTextID2 = sheetReportNumber ? ` dengan Report Number ${sheetReportNumber}` : '';
        const rnSubjectEN2 = sheetReportNumber ? `Your Report Number ${sheetReportNumber}` : 'Your credit limit top-up';

        if (status === 'REJECTED' && reporterPhone) {
          await sendMessage(
            reporterPhone,
            `❌ Halo ${reporterName || ''}! Credit Limit Top Up${rnTextID2} ditolak.\n\nAlasan: ${reason}\n\nKamu bisa submit ulang dengan ketik *START*.\n\n_(${rnSubjectEN2} was rejected. Reason: ${reason}. Type START to resubmit.)_`
          );
        }

        if (status === 'APPROVED' && reporterPhone) {
          await sendMessage(
            reporterPhone,
            `✅ Halo ${reporterName || ''}! Credit Limit Top Up${rnTextID2} disetujui oleh tim.\n\nTim engineering akan segera memprosesnya.\n\n_(${rnSubjectEN2} has been approved by ${reviewedBy || 'Ops'}. The engineering team will process it soon.)_`
          );
        }

        console.log(`[Sheet Update] ${status} ${requestId} by ${reviewedBy}${reason ? ': ' + reason : ''}`);
      }

      // ── RESOLVED / Resolved — sent when Ops or engineer marks the ticket as done ──
      if (status.toUpperCase() === 'RESOLVED' && reporterPhone) {
        // Guard: if the Slack :done: reaction already sent the WA (registry DONE), skip
        let alreadyNotified = false;
        if (slackTs) {
          try {
            const regEntry = await reportRegistry.get(slackTs);
            if (regEntry?.status === 'DONE') {
              alreadyNotified = true;
              console.log(`[Sheet Update] RESOLVED ${requestId} — already notified via Slack event, skipping duplicate WA`);
            }
          } catch {}
        }

        if (!alreadyNotified) {
          let resolvedReportNumber = '';
          try {
            const rowData = await googleSheets.findByRequestId(requestId);
            resolvedReportNumber = rowData?.data?.reportNumber || '';
          } catch {}
          const rnTextRes = resolvedReportNumber ? ` dengan Report Number ${resolvedReportNumber}` : '';
          const rnSubjectRes = resolvedReportNumber ? `Your Report Number ${resolvedReportNumber}` : 'Your credit limit top-up';

          try {
            await sendMessage(
              reporterPhone,
              `✅ Halo ${reporterName || ''}! Credit Limit Top Up${rnTextRes} sudah diproses oleh tim.\n\n_(${rnSubjectRes} has been processed by the team.)_`
            );
            console.log(`[Sheet Update] RESOLVED WA sent to ${reporterPhone} for ${requestId}`);
          } catch (waErr: any) {
            console.error(`[Sheet Update] RESOLVED WA failed for ${reporterPhone}: ${waErr.message}`);
          }
        }
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

  // GET farmer database for cascading FG → Farmer dropdowns
  app.get("/api/farmers", async (_req, res) => {
    try {
      const farmers = await googleSheets.getFarmerDatabase();
      res.json(farmers);
    } catch (err: any) {
      console.error('[API] /api/farmers error:', err.message);
      res.status(500).json({ error: 'Failed to load farmer database', details: err.message });
    }
  });

  // File upload with multer (memory storage)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  });

  const creditLimitUpload = upload.fields([
    { name: 'docSignedSO', maxCount: 20 },
    { name: 'docFarmerHolding', maxCount: 20 },
    { name: 'docLandOwnership', maxCount: 20 },
    { name: 'docJaminan', maxCount: 20 },
    { name: 'docSurveyPhotoTM', maxCount: 20 },
  ]);

  // POST credit limit form submission
  app.post("/api/credit-limit/submit", (req: any, res: any, next: any) => {
    creditLimitUpload(req, res, (err: any) => {
      if (err) {
        console.error(`[Form] Multer error: ${err.code} — ${err.message} (field: ${err.field || 'unknown'})`);
        return res.status(400).json({
          error: err.message || 'File upload error',
          code: err.code || 'ERR_UPLOAD',
        });
      }
      next();
    });
  }, async (req: any, res: any) => {
    const startTime = Date.now();
    const logId = uuidv4().substring(0, 6).toUpperCase();

    try {
      const body = req.body;
      const files = req.files || {};

      console.log(`[Form][${logId}] === NEW SUBMISSION ===`);
      console.log(`[Form][${logId}] Reporter: ${body.reporterPhone}, Farmer: ${body.farmerName}, Type: ${body.creditLimitType}`);

      // ── STEP 1: Validate required fields ──
      const required = ['reporterPhone', 'fgName', 'farmerName', 'landSizeVerified', 'currentLimit', 'requestedTopUp', 'creditType', 'reason'];
      const missing = required.filter(f => !body[f]);
      if (missing.length > 0) {
        console.warn(`[Form][${logId}] ERR_VALIDATION: Missing fields: ${missing.join(', ')}`);
        return res.status(400).json({
          error: `Missing fields: ${missing.join(', ')}`,
          code: 'ERR_VALIDATION',
          logId,
        });
      }

      // ── STEP 2: Verify reporter identity ──
      const profile = lookupProfile(body.reporterPhone);
      if (!profile) {
        console.warn(`[Form][${logId}] ERR_NOT_WHITELISTED: Phone ${body.reporterPhone} not found`);
        return res.status(403).json({
          error: 'Phone number not in whitelist. Contact your Territory Manager.',
          code: 'ERR_NOT_WHITELISTED',
          logId,
        });
      }

      console.log(`[Form][${logId}] Reporter verified: ${profile.name} (${profile.area})`);

      const requestId = uuidv4().substring(0, 8).toUpperCase();
      const timestamp = getWIBTimestamp();
      const isLargeFarmer = body.creditLimitType === 'largeFarmer';

      // ── STEP 3: Upload ALL documents to Google Drive (parallel) ──
      console.log(`[Form][${logId}] Uploading documents to Google Drive...`);
      const driveUrls: Record<string, string> = {};
      const uploadErrors: string[] = [];
      const docFields = ['docSignedSO', 'docFarmerHolding', 'docLandOwnership', 'docJaminan', 'docSurveyPhotoTM'];

      // Build flat list of all upload tasks
      type UploadTask = { fieldName: string; index: number; file: any; fileName: string };
      const uploadTasks: UploadTask[] = [];
      for (const fieldName of docFields) {
        const fileArr = files[fieldName];
        if (fileArr && fileArr.length > 0) {
          fileArr.forEach((file: any, i: number) => {
            const ext = file.originalname.split('.').pop() || 'jpg';
            uploadTasks.push({ fieldName, index: i, file, fileName: `${requestId}_${fieldName}_${i + 1}.${ext}` });
          });
        }
      }

      const totalFiles = uploadTasks.length;
      if (totalFiles > 0) {
        // Pre-create subfolder once to avoid race conditions on parallel upload
        const { drive: sharedDrive, folderId: subFolderId } = await googleDrive.ensureRequestSubfolder(requestId);

        // Upload all files in parallel (with 1 retry each)
        const results = await Promise.allSettled(
          uploadTasks.map(async ({ fieldName, file, fileName }) => {
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                console.log(`[Form][${logId}] Uploading ${fileName} (${(file.size / 1024).toFixed(0)} KB) attempt ${attempt}...`);
                const url = await googleDrive.uploadFileToFolder(sharedDrive, file.buffer, fileName, file.mimetype, subFolderId);
                console.log(`[Form][${logId}] ✅ ${fileName} → ${url}`);
                return { fieldName, url };
              } catch (err: any) {
                console.error(`[Form][${logId}] ❌ Upload failed (attempt ${attempt}): ${fileName} — ${err.message}`);
                if (attempt === 2) throw new Error(`${fileName}: ${err.message}`);
              }
            }
          })
        );

        // Aggregate results preserving field order
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value) {
            const { fieldName, url } = res.value;
            driveUrls[fieldName] = driveUrls[fieldName] ? `${driveUrls[fieldName]}\n${url}` : url;
          } else if (res.status === 'rejected') {
            uploadErrors.push(res.reason?.message || 'Unknown upload error');
          }
        }
      }

      const uploadedFiles = Object.values(driveUrls).reduce((sum, urls) => sum + urls.split('\n').length, 0);
      console.log(`[Form][${logId}] Drive upload: ${uploadedFiles}/${totalFiles} files uploaded (parallel)`);

      if (uploadErrors.length > 0) {
        console.error(`[Form][${logId}] ERR_DRIVE_UPLOAD: ${uploadErrors.length} file(s) failed: ${uploadErrors.join('; ')}`);
      }

      // If ALL files failed to upload, stop submission
      if (totalFiles > 0 && uploadedFiles === 0) {
        return res.status(500).json({
          error: 'All document uploads failed. Please try again.',
          code: 'ERR_DRIVE_UPLOAD_ALL_FAILED',
          logId,
          details: uploadErrors,
        });
      }

      // ── STEP 4: Generate Report Number ──
      const reportNumber = await getNextReportNumber('CRD');
      console.log(`[Form][${logId}] Report Number: ${reportNumber}`);

      // ── STEP 5: Post to Slack ──
      console.log(`[Form][${logId}] Posting to Slack...`);
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

      const fakeSession: any = {
        phoneNumber: body.reporterPhone,
        senderName: profile.name,
        profile,
        reportType: 'creditTopUp',
        creditLimitType: body.creditLimitType || 'standard',
        mediaUrls: [],
      };

      let slackTs = '';
      let slackChannel = '';
      try {
        const slackResult = await postCreditLimitToSlack(fakeSession, slackData, (ts, channel) => {
          slackTs = ts;
          slackChannel = channel;
          sessionStore.storeSlackMapping(ts, channel, {
            phoneNumber: body.reporterPhone,
            senderName: profile.name,
            reportType: 'creditTopUp',
            requestId,
            farmerName: body.farmerName,
            reportNumber,
          });
        }, reportNumber);
        slackTs = slackResult.ts || slackTs;
        slackChannel = slackResult.channel || slackChannel;
        console.log(`[Form][${logId}] ✅ Slack posted (ts: ${slackTs})`);

        if (slackTs && slackChannel) {
          await reportRegistry.set({
            messageTs:   slackTs,
            channelId:   slackChannel,
            reportNumber,
            phone:       body.reporterPhone,
            name:        profile.name,
            type:        'credit',
          });
        }
      } catch (slackErr: any) {
        console.error(`[Form][${logId}] ERR_SLACK: ${slackErr.message}`);
        // Continue — Slack failure should not block the submission
      }

      // ── STEP 6: Write to Google Sheets ──
      console.log(`[Form][${logId}] Writing to Google Sheets...`);
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
        docSignedSO: driveUrls.docSignedSO || '',
        docFarmerHolding: driveUrls.docFarmerHolding || '',
        docLandOwnership: driveUrls.docLandOwnership || '',
        docJaminan: driveUrls.docJaminan || '',
        docSurveyPhotoTM: driveUrls.docSurveyPhotoTM || '',
        status: 'PENDING',
        reviewedBy: '',
        reviewDate: '',
        rejectionReason: '',
        slackMessageTs: slackTs,
        reportNumber,
      };

      try {
        await googleSheets.appendRequest(sheetRow);
        console.log(`[Form][${logId}] ✅ Google Sheets row written`);
      } catch (sheetErr: any) {
        console.error(`[Form][${logId}] ERR_SHEETS: ${sheetErr.message}`);
        return res.status(500).json({
          error: 'Failed to save to Google Sheets. Data not recorded.',
          code: 'ERR_SHEETS',
          logId,
          details: sheetErr.message,
        });
      }

      // ── STEP 7: Log activity ──
      addReportLog({
        type: 'creditTopUp',
        reporter: profile.name,
        phoneNumber: body.reporterPhone,
        summary: `[FORM] Credit Limit Top Up — ${body.farmerName} — ${body.creditType}`,
        status: 'submitted',
      });

      // ── STEP 8: Send WhatsApp notification ──
      try {
        await sendMessage(
          body.reporterPhone,
          `✅ Halo ${profile.name}! Permintaan credit limit top up untuk ${body.farmerName} sudah dikirim via form.\n\nReport Number: *${reportNumber}*\nTim Ops Excellence akan review permintaan kamu.\n\nKamu akan mendapat notifikasi saat di-approve atau di-reject.\n\n_(Credit Limit Top Up submitted via form. Report Number: ${reportNumber}.)_`
        );
        console.log(`[Form][${logId}] ✅ WhatsApp notification sent`);
      } catch (waErr: any) {
        console.error(`[Form][${logId}] ERR_WHATSAPP: ${waErr.message}`);
        // Continue — WA failure should not block the response
      }

      // ── DONE ──
      const duration = Date.now() - startTime;
      console.log(`[Form][${logId}] === DONE in ${duration}ms === Request ID: ${requestId}`);

      const warnings: string[] = [];
      if (uploadErrors.length > 0) warnings.push(`${uploadErrors.length} file(s) failed to upload to Drive`);
      if (!slackTs) warnings.push('Slack notification failed');

      res.json({
        success: true,
        requestId,
        logId,
        message: `Credit Limit Top Up submitted. Request ID: ${requestId}`,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`[Form][${logId}] ERR_UNKNOWN (${duration}ms): ${err.message}`);
      console.error(`[Form][${logId}] Stack: ${err.stack}`);
      res.status(500).json({
        error: 'Something went wrong. Please try again or contact support.',
        code: 'ERR_UNKNOWN',
        logId,
        details: err.message,
      });
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
