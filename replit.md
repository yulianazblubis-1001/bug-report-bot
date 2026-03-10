# Rize Report Bot — WhatsApp to Slack Reporter

## Overview
A WhatsApp chatbot that guides Rize.farm agronomists through bug reports, admin requests, and credit limit top-up requests using Claude AI for all conversation flows. The bot speaks casual Indonesian, enforces mandatory fields, and posts professional Slack cards.

## Architecture
- **Frontend**: React + Vite dashboard at `/` showing bot status, activity logs, configuration
- **Backend**: Express server handling WATI webhooks (`/webhook`, `/api/bot/webhook`), Slack events (`/slack-events`), sheet updates (`/sheet-update`), and API routes (`/api/bot/*`)
- **Bot Engine**: Claude AI for all report types (bug, admin, credit limit top-up)

## Key Files

### Server / Bot
| File | Purpose |
|------|---------|
| `server/routes.ts` | Express routes: webhook, slack-events, sheet-update, API endpoints |
| `server/bot/session.ts` | In-memory session store with 30-min TTL, conversation history, Slack mapping |
| `server/bot/router.ts` | Message routing + conversation flow (SELECT_TYPE → SELECT_ADMIN_TYPE → SELECT_CREDIT_TYPE → COLLECTING → CONFIRMING) |
| `server/bot/activityLog.ts` | In-memory activity log for dashboard |
| `server/bot/services/claude-agent.ts` | Claude Sonnet 4 agent — evaluates bug/admin/creditTopUp reports with distinct system prompts |
| `server/bot/services/wati.ts` | WATI API wrapper (sendSessionMessage with query param) |
| `server/bot/services/slack.ts` | Slack Block Kit formatter, credit limit blocks, thread replies, emoji reactions |
| `server/bot/services/google-sheets.ts` | Google Sheets API — append/update/find credit limit rows (Replit Google Sheets integration) |
| `server/bot/services/google-drive.ts` | Google Drive API — upload documents, set permissions (Replit Google Drive integration) |
| `server/bot/whitelist.ts` | Phone whitelist from agronomist database |
| `server/bot/agronomist-database.json` | 71 agronomist profiles (name, area, email, phone) |
| `google-apps-script.js` | Google Apps Script for Sheet onEdit trigger → POST /sheet-update |

### Frontend
| File | Purpose |
|------|---------|
| `client/src/pages/dashboard.tsx` | Main dashboard page |
| `client/src/App.tsx` | App router |

## Report Types

### 1. Bug Report (AI-guided)
- Uses Claude AI to collect info conversationally
- Mandatory: PG Name, Steps to Reproduce, App Version, Platform, Screenshot/Video
- Conditional: Farmer Name, Invoice Number (payment issues)
- Max 3 follow-up questions, translates to English for Slack
- Posts to `SLACK_CHANNEL_BUG`

### 2. Admin Request (AI-guided)
- General admin requests (reset password, etc.)
- Uses Claude AI for collection
- Posts to `SLACK_CHANNEL_ADMIN`

### 3. Credit Limit Top Up (AI-guided)
- Sub-menu: Standard (< 2.5 Ha) or Petani Besar / Large Farmer (> 2.5 Ha s/d 5 Ha)
- Uses Claude AI with specialized system prompt adapted per `creditLimitType`
- Standard: up to 8 follow-ups | Large Farmer: up to 12 follow-ups
- Always required: FG Name, Farmer Name, Land Parcel Size, Current Limit, Requested Top-Up, Credit Type (3 options: Agri Input / Mechanization / Both), Reason
- Conditional (Agri Input): SO Number, Signed SO photo, Farmer holding SO photo
- Conditional (Mechanization): Signed Request Letter photo, Farmer holding Request Letter photo
- If Credit Type = Both: ALL documents from both types required
- Large Farmer additional: Farmer Income Sources, Business Potential, Land Ownership Proof, Collateral Type, Collateral Photo, Collateral Certificate, Credit Limit Request Amount
- Claude does NOT validate amounts — that's Ops Excellence's job
- Documents uploaded to Google Drive → shareable URLs
- Data written to Google Sheets (21 columns, docs collapsed into M-P; full links in Slack card)
- Posts to `SLACK_CHANNEL_CREDIT_LIMIT` with Ops Excellence mentions
- Approval from Google Sheet (onEdit trigger) → POST /sheet-update (with optional SHEET_WEBHOOK_SECRET)
- Engineer resolution: ✅ reaction when processed → WhatsApp notification

## Slack Card Format
- Bug/Admin: `[Category] Short English summary` (no emojis)
- Credit Limit: `🏦 CREDIT LIMIT TOP UP REQUEST` with structured fields, doc links, validation flags
- Categories: App Bug, Farmer Data, Payment, Field Task, Account, Carbon/AWD, UI/UX, Admin Request, Other

## Google Sheets Column Structure (Credit Limit — 23 columns A-W)
| Col | Header | Source |
|-----|--------|--------|
| A | Timestamp | Auto (WIB) |
| B | Request ID | Auto UUID |
| C | Reporter Name | Session |
| D | Reporter Phone | Session |
| E | FG | Claude parsedReport |
| F | Farmer | Claude parsedReport |
| G | Land Size Verified | Claude parsedReport |
| H | Current Limit | Claude parsedReport |
| I | Requested Top-Up | Claude parsedReport |
| J | Credit Type | Claude parsedReport |
| K | Reason | Claude parsedReport |
| L | SO Number | Claude parsedReport (Agri Input only) |
| M | Farmer Source of Income & Potential Business | Combined `;`-separated (Large Farmer only) |
| N | Jenis Jaminan - nilai jaminan | Combined `;`-separated (Large Farmer only) |
| O | Doc: Signed SO/Request Letter | Google Drive URL |
| P | Doc: Farmer Holding Document | Google Drive URL |
| Q | Doc: Land Ownership Proof | Google Drive URL (Large Farmer only) |
| R | Doc: Dokumen Jaminan | Google Drive URL (Large Farmer only) |
| S | Status | PENDING → APPROVED/REJECTED → RESOLVED |
| T | Reviewed By | Google Sheet (Ops fills) |
| U | Review Date | Auto |
| V | Rejection Reason | Google Sheet (Ops fills) |
| W | Slack Message TS | System |

## Credit Limit Approval Workflow
1. Agronomist submits via WhatsApp → data written to Google Sheets as PENDING
2. Slack card posted to credit limit channel, mentioning Ops Excellence team
3. Ops Excellence reviews in Google Sheet, changes Status (col Q) to APPROVED or REJECTED
4. Google Apps Script `onEdit` trigger sends POST to `/sheet-update`
5. APPROVED: `:git-approved:` emoji on Slack, thread reply tagging engineers
6. REJECTED: `:rejected:` emoji on Slack, WhatsApp notification to reporter with reason
7. Engineer reacts ✅ or :done: on Slack → Sheet updated to RESOLVED, WhatsApp notification sent

## Environment Variables
- `WATI_API_ENDPOINT` — WATI API base URL
- `WATI_TOKEN` — WATI Bearer token
- `SLACK_WEBHOOK_BUG` — Slack webhook for bug reports (fallback)
- `SLACK_WEBHOOK_ADMIN` — Slack webhook for admin requests (fallback)
- `SLACK_BOT_TOKEN` — Slack Bot User OAuth Token (xoxb-) for Web API
- `SLACK_CHANNEL_BUG` — Slack channel ID for bug reports (C085L46D50A)
- `SLACK_CHANNEL_ADMIN` — Slack channel ID for admin requests (C0766PKUK1N)
- `SLACK_CHANNEL_CREDIT_LIMIT` — Slack channel ID for credit limit requests (C0766PKUK1N)
- `SLACK_MENTION_OPS` — Comma-separated Slack user IDs for Ops Excellence mentions
- `GOOGLE_SHEETS_ID` — Google Sheets spreadsheet ID for credit limit data
- `GOOGLE_DRIVE_FOLDER_ID` — Google Drive folder ID for document uploads
- `ANTHROPIC_API_KEY` — Claude AI key for conversation agent
- `SLACK_SIGNING_SECRET` — Slack signature verification
- `SESSION_SECRET` — Express session secret

## Slack Integration
- Primary: Uses Slack Web API (`chat.postMessage`) with `SLACK_BOT_TOKEN`
- Slack Events endpoint: `/api/bot/slack-events` and `/slack-events`
- Handles: `reaction_added` (bug/admin done/solve, credit limit engineer resolution)
- Reactions API for approval/rejection emojis (:git-approved:, :rejected:)
- Bot needs OAuth scopes: chat:write, reactions:read, reactions:write, files:write, users:read
- Bot must be invited to all channels
- Slack app needs Event Subscriptions: reaction_added, message.channels

## Google Integrations
- Google Sheets: Uses Replit Google Sheets connector (OAuth via Replit integrations)
- Google Drive: Uses Replit Google Drive connector (OAuth via Replit integrations)
- Never cache the client — tokens expire, always get fresh client

## How It Works
1. Agronomist sends WhatsApp message via WATI
2. Whitelist check — rejects unregistered numbers, auto-identifies from database
3. User picks Bug Report (1) or Admin Request (2)
4. If Admin Request → sub-menu: General (1) or Credit Limit Top Up (2)
5. If Credit Limit → sub-menu: Standard (1) or Petani Besar/Large Farmer (2)
6. All types: Claude AI evaluates, enforces mandatory fields, asks follow-ups
7. Credit Limit: Claude uses specialized prompt per creditLimitType, 8 follow-ups (standard) or 12 (large farmer)
7. When ready, shows summary for confirmation (KIRIM to submit, ULANG to restart)
8. On submit: posts Slack card, uploads docs to Google Drive, writes Google Sheets
9. Credit limit approval: Ops edits Sheet → Apps Script triggers /sheet-update → Slack reactions + WhatsApp
10. Engineer resolves with ✅ reaction → Sheet updated, WhatsApp notification

## Technical Notes
- WATI sendSessionMessage uses query param `messageText`, not JSON body
- WATI_TOKEN value already includes "Bearer " prefix — do NOT add another
- Claude Sonnet 4 for all conversation types (bug, admin, creditTopUp)
- Sessions auto-expire after 30 minutes of inactivity
- Trigger keywords: BUG, REPORT, ADMIN, REQUEST, START, MULAI, MENU, LAPOR
- Google Apps Script: paste `google-apps-script.js` content into Sheet's Apps Script editor
- Sheet tab name is "request" (not "Sheet1") — all range references use `request!` prefix
- Apps Script watches col S (19) for status change, tab must be named "request"
