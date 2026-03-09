# Rize Report Bot — WhatsApp to Slack Reporter

## Overview
A WhatsApp chatbot that guides Rize.farm agronomists through bug reports, admin requests, and credit limit top-up requests using a combination of Claude AI and step-by-step flows. The bot speaks casual Indonesian, enforces mandatory fields, and posts professional Slack cards.

## Architecture
- **Frontend**: React + Vite dashboard at `/` showing bot status, activity logs, configuration
- **Backend**: Express server handling WATI webhooks (`/webhook`, `/api/bot/webhook`), Slack events (`/slack-events`), and API routes (`/api/bot/*`)
- **Bot Engine**: Claude AI for bug/admin reports, step-by-step state machine for credit limit top-up

## Key Files

### Server / Bot
| File | Purpose |
|------|---------|
| `server/routes.ts` | Express routes: webhook, slack-events (reactions + thread replies), API endpoints |
| `server/bot/session.ts` | In-memory session store with 30-min TTL, conversation history, Slack mapping |
| `server/bot/router.ts` | Message routing + conversation flow (SELECT_TYPE → SELECT_ADMIN_TYPE → COLLECTING → CONFIRMING) |
| `server/bot/activityLog.ts` | In-memory activity log for dashboard |
| `server/bot/services/claude-agent.ts` | Claude Sonnet 4 agent — evaluates reports, enforces mandatory fields, extracts structured data |
| `server/bot/services/wati.ts` | WATI API wrapper (sendSessionMessage with query param) |
| `server/bot/services/slack.ts` | Slack Block Kit formatter — professional [Category] Title cards, credit limit blocks, thread replies |
| `server/bot/services/google-sheets.ts` | Google Sheets API — append/update/find credit limit rows (Replit Google Sheets integration) |
| `server/bot/services/google-drive.ts` | Google Drive API — upload documents, set permissions (Replit Google Drive integration) |
| `server/bot/whitelist.ts` | Phone whitelist from agronomist database |
| `server/bot/agronomist-database.json` | 71 agronomist profiles (name, area, email, phone) |
| `server/bot/flows/creditLimitTopUp.ts` | Step-by-step credit limit top-up flow with conditional steps |
| `server/bot/flows/bugReport.ts` | Step-by-step bug report flow (legacy, unused — Claude AI used instead) |
| `server/bot/flows/adminRequest.ts` | Step-by-step admin request flow (legacy, unused — Claude AI used instead) |

### Frontend
| File | Purpose |
|------|---------|
| `client/src/pages/dashboard.tsx` | Main dashboard page |
| `client/src/App.tsx` | App router |

### Shared
| File | Purpose |
|------|---------|
| `shared/schema.ts` | TypeScript types (BotStatus, ReportLog) |

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

### 3. Credit Limit Top Up (Step-by-step)
- NO AI during data collection — strict state machine
- Always-asked: FG Name, Farmer Name, Land Parcel Size, Current Limit, Requested Top-Up, Credit Type, Reason
- Conditional (Agri Input): SO Number, Signed SO photo, Farmer holding SO photo
- Conditional (Mechanization): Signed Request Letter photo, Farmer holding Request Letter photo
- Conditional (Land > 2.5 Ha / Large Farmer): Proof of land ownership, Dokumen Jaminan
- Documents uploaded to Google Drive → shareable URLs
- Data written to Google Sheets (21 columns)
- Posts to `SLACK_CHANNEL_CREDIT_LIMIT` with approval workflow
- Thread-based approval: Ops replies APPROVED or REJECTED [reason]
- Engineer resolution: ✅ reaction when processed → WhatsApp notification

## Slack Card Format
- Bug/Admin: `[Category] Short English summary` (no emojis)
- Credit Limit: `🏦 CREDIT LIMIT TOP UP REQUEST` with structured fields
- Categories: App Bug, Farmer Data, Payment, Field Task, Account, Carbon/AWD, UI/UX, Admin Request, Other

## Google Sheets Column Structure (Credit Limit)
| Col | Header | Source |
|-----|--------|--------|
| A | Timestamp | Auto (WIB) |
| B | Request ID | Auto UUID |
| C | Reporter Name | Session |
| D | Reporter Phone | Session |
| E | FG | Step |
| F | Farmer | Step |
| G | Land Size Verified | Step |
| H | Current Limit | Step |
| I | Requested Top-Up | Step |
| J | Credit Type | Step |
| K | Reason | Step |
| L | SO Number | Step (Agri Input only) |
| M | Doc: Signed SO/Request Letter | Google Drive URL |
| N | Doc: Farmer Holding Document | Google Drive URL |
| O | Doc: Land Ownership Proof | Google Drive URL (Large Farmer only) |
| P | Doc: Dokumen Jaminan | Google Drive URL (Large Farmer only) |
| Q | Status | PENDING → APPROVED/REJECTED → RESOLVED |
| R | Reviewed By | Slack thread |
| S | Review Date | Auto |
| T | Rejection Reason | Slack thread |
| U | Slack Message TS | System |

## Credit Limit Approval Workflow
1. Agronomist submits via WhatsApp → data written to Google Sheets as PENDING
2. Slack card posted to credit limit channel, mentioning Ops Excellence team
3. Ops replies in Slack thread: APPROVED or REJECTED [reason]
4. APPROVED: Sheet updated, thread reply posted, wait for engineer reaction
5. REJECTED: Sheet updated, WhatsApp notification to reporter with reason
6. Engineer reacts ✅ or :done: → Sheet updated to RESOLVED, WhatsApp notification sent

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
- Handles: `reaction_added` (bug/admin done/solve, credit limit resolution) and `message` (thread replies for credit limit approval)
- Bot needs OAuth scopes: chat:write, reactions:read, files:write, users:read
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
5. Bug/Admin: Claude AI evaluates, enforces mandatory fields, asks follow-ups (max 3)
6. Credit Limit: Step-by-step state machine, conditional document requirements
7. When ready, shows summary for confirmation (KIRIM to submit, ULANG to restart)
8. On submit: posts Slack card, uploads docs to Google Drive, writes Google Sheets
9. Credit limit: Ops approves/rejects in Slack thread → WhatsApp notification
10. Engineer resolves with reaction → Sheet updated, WhatsApp notification

## Technical Notes
- WATI sendSessionMessage uses query param `messageText`, not JSON body
- WATI_TOKEN value already includes "Bearer " prefix — do NOT add another
- Claude Sonnet 4 for bug/admin conversation evaluation
- Credit limit flow uses NO AI — pure step-by-step state machine
- Sessions auto-expire after 30 minutes of inactivity
- Trigger keywords: BUG, REPORT, ADMIN, REQUEST, START, MULAI, MENU, LAPOR
