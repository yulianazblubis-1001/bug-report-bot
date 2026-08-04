# Bug Report Bot — Technical Requirements Document

> **Purpose:** Reference document for migrating the WhatsApp-based bug/admin report bot to Claude Code or any other runtime. Covers architecture, data flows, integrations, and implementation decisions.

---

## 1. Overview

A WhatsApp bot that lets Rize.farm agronomists report bugs, submit admin requests, and request credit limit top-ups — directly from WhatsApp via WATI. The bot uses Claude AI to conduct a structured interview, collects all required information, then posts a formatted card to the appropriate Slack channel and logs entries to Google Sheets.

---

## 2. File Structure

```
server/
├── routes.ts                        # Express routes: WATI webhook, Slack event listener, credit form
└── bot/
    ├── router.ts                    # Core state machine — all WhatsApp message handling
    ├── session.ts                   # In-memory session store + Postgres Slack mapping facade
    ├── whitelist.ts                 # Agronomist lookup against local JSON
    ├── activityLog.ts               # Capped in-memory audit log (max 100 entries)
    ├── agronomist-database.json     # Whitelist: phone → {name, area, personalEmail, zohoEmail}
    └── services/
        ├── wati.ts                  # WATI outbound API (sendMessage, sendTemplate)
        ├── claude-agent.ts          # Claude AI prompting, response parsing
        ├── slack.ts                 # Slack card builders, postToSlack, media upload, reactions
        ├── google-sheets.ts         # Sheets: counters, credit requests, registry, farmer DB
        ├── google-drive.ts          # WATI media download + optional Drive upload
        ├── reportCounter.ts         # Atomic report number generation (YYYYMMDD-TYPE-N)
        ├── reportRegistry.ts        # Sheets-backed report lifecycle tracker
        ├── slack-map-db.ts          # Postgres: Slack ts ↔ request ID mappings
        └── translate.ts             # (Exists, not currently wired into router)
```

---

## 3. External Services & Credentials

| Service | Purpose | Credential(s) |
|---|---|---|
| WATI | Receive WhatsApp messages, send replies | `WATI_API_ENDPOINT`, `WATI_TOKEN` |
| Anthropic Claude | AI-driven interview & report extraction | `ANTHROPIC_API_KEY` |
| Slack | Post formatted report cards, receive reactions/replies | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_WEBHOOK_BUG`, `SLACK_WEBHOOK_ADMIN`, `SLACK_CHANNEL_BUG`, `SLACK_CHANNEL_ADMIN`, `SLACK_CHANNEL_CREDIT_LIMIT` |
| Google Sheets | Report counters, credit requests, registry, farmer DB | Via Replit Google connector (`google-sheet`) + `GOOGLE_SHEETS_ID` |
| PostgreSQL | Persistent Slack message ↔ request mappings | Replit built-in DB |
| App URL | Credit limit form base URL | `APP_URL` (fallback: `https://bug-report-bot.replit.app`) |

---

## 4. Whitelist & User Profiles

**File:** `server/bot/agronomist-database.json`

```json
{
  "6281234567890": {
    "name": "Full Name",
    "area": "Karawang",
    "personalEmail": "personal@gmail.com",
    "zohoEmail": "name@rize-ops.farm"
  }
}
```

- Keys are **normalized phone numbers** (strip `+`, spaces, hyphens, parentheses).
- Indonesian numbers starting with `08` are converted to `628...` format on ingestion.
- Lookup is in `whitelist.ts`. Unknown numbers receive no response unless they sent a trigger keyword, in which case they get a rejection message.

---

## 5. Session Lifecycle

**File:** `server/bot/session.ts`

### Session Object

```typescript
{
  phoneNumber: string;
  senderName: string;
  profile: AgronomistProfile | null;        // from whitelist
  step: 'SELECT_TYPE' | 'SELECT_ADMIN_TYPE' | 'SELECT_CREDIT_TYPE' | 'COLLECTING' | 'CONFIRMING';
  reportType: 'bug' | 'admin' | 'changePhone' | 'creditTopUp' | null;
  conversation: ConversationMessage[];       // full chat history sent to Claude
  parsedReport: Record<string, any> | null; // latest Claude-parsed fields
  mediaUrls: string[];                       // all WATI media URLs collected
  followUpCount: number;                     // number of AI follow-ups asked
  isProcessing: boolean;                     // mutex: prevents parallel Claude calls
  lastActivity: number;                      // timestamp, refreshed on every message
  createdAt: number;
}
```

### Lifecycle Rules

| Event | Action |
|---|---|
| First trigger keyword | `sessionStore.create(phone)` — resets any existing session |
| Every inbound message | `session.lastActivity = Date.now()` |
| `get()` on expired session | Session deleted, returns `null` |
| Post-submission | `sessionStore.reset(phone)` — deletes immediately |
| **TTL** | **30 minutes** of inactivity |
| **Cleanup interval** | Every **5 minutes** (background sweep) |

### Processing Lock (`isProcessing`)

While Claude is being called, `isProcessing = true`. Any message arriving during this window is **queued** (media URLs are buffered; text is dropped). When the Claude call resolves, queued media is flushed into the session.

---

## 6. Webhook & Routing

### Inbound (WATI → Bot)

**Route:** `POST /webhook` and `POST /api/bot/webhook` (both handled in `server/routes.ts`)

WATI payload fields extracted:
- `waId` / `fullPhoneNumber` → `phoneNumber` (normalized)
- `senderName`
- `text` → message text
- `type` → `text | image | video | document | button | interactive`
- `data` → media URL (if type is media)

No WATI signature verification is implemented on the webhook. Credit form webhook uses `x-webhook-secret` / query secret.

After extraction, `handleMessage(phoneNumber, senderName, text, type, mediaUrl)` is called from `server/bot/router.ts`.

### Slack Inbound (Slack → Bot)

**Route:** `POST /slack-events` and `POST /api/bot/slack-events` (in `server/routes.ts`)

- Verifies `x-slack-signature` HMAC against `SLACK_SIGNING_SECRET`; returns 401 on mismatch.
- Handles Slack `event_callback` (messages, reactions) and `block_actions` (button clicks).
- Maps Slack `message_ts` → request ID via Postgres to correlate follow-ups.
- Updates Google Sheets status on approval/rejection.
- Sends WATI notification back to the reporter on status change.

---

## 7. Message Routing State Machine

All logic lives in `server/bot/router.ts` → `handleMessage()`.

### Trigger Keywords (case-insensitive, create new session)

`START`, `MULAI`, `MENU`, `BUG`, `REPORT`, `ADMIN`, `REQUEST`, `LAPOR`

- Exception: `MULAI ISI` is excluded (used for credit form).
- Trigger resets any existing session and sends the welcome menu.

### Non-whitelisted Users

Silently ignored. No response sent.

### Whitelisted + No Active Session

- If message is `1`, `2`, or `3` → re-show welcome menu (graceful recovery).
- Otherwise → silently ignored.

### Step Flow

```
[Welcome Menu]
    1 → Bug Report (step: COLLECTING, reportType: 'bug')
    2 → Admin Submenu

[Admin Submenu]
    1 → General Admin (step: COLLECTING, reportType: 'admin')
    2 → Credit Limit Submenu
    3 → Change Phone (step: COLLECTING, reportType: 'changePhone')

[Credit Limit Submenu]
    1 → Standard form link → session.reset()
    2 → Large Farmer form link → session.reset()

[COLLECTING]
    - Each message appended to session.conversation
    - Claude called via evaluateReport()
    - If status = need_more_info AND followUpCount < max → send follow-up question, followUpCount++
    - If status = ready OR followUpCount >= max → build summary → step: CONFIRMING

[CONFIRMING]
    - KIRIM / SUBMIT / SEND → submitReport()
    - ULANG / EDIT → back to COLLECTING (clears parsedReport)
    - CANCEL / BATAL → session.reset()
    - Media messages → add to session.mediaUrls (still confirming)

[Any step]
    - ULANG → restart collection for same reportType
    - START / MULAI / MENU → full session reset, show welcome menu
```

### Global Commands (work at any step)

| Command | Action |
|---|---|
| `START`, `MULAI`, `MENU` | Reset session, show welcome menu |
| `ULANG` | Reset to COLLECTING for same report type |
| `CANCEL`, `BATAL` | Delete session entirely |

---

## 8. Report Types

### 8.1 Bug Report (`reportType: 'bug'`)

**Max Claude follow-ups:** 5

**Mandatory fields (Claude must collect all before `ready`):**
1. PG Name (`pgName`)
2. Steps to Reproduce (`stepsToReproduce`)
3. App Version (`appVersion`)
4. Platform — Android / iOS / Web (`platform`)
5. Screenshot or video — at least 1 media file (tracked via `hasScreenshot`)
6. Error Details — exact error text from popup/network log; accept `"-"` only if user says they don't have it after two attempts (`errorDetails`)

**Conditional — Payment/Invoice issues** (keywords: invoice, faktur, quotation, penawaran, tagihan):
- Farmer Name (`farmerName`)
- Invoice/Quotation Number (`invoiceNumber`)
- Invoice Type — mechanization / agri input / advisory (`invoiceType`)
- If number change: current number (`invoiceCurrentNumber`) + new number (`invoiceNewNumber`)

**Conditional — Quotation status not changing to approved** (keywords: status not approved, belum approved, farmer sudah klik):
- **Screenshot of WA chat with farmer showing their click/confirmation is mandatory.** Bot will not submit until this screenshot is received.

**Categories:** App Bug | Farmer Data | Payment | Field Task | Account | Carbon/AWD | UI/UX | Other

**P0 auto-tagging** (Slack priority flag, detected by keyword scan on report text):
- Login failures, server down, collection = 0, credit = 0, VA issues, invoice/payment failures

**Slack channel:** `SLACK_CHANNEL_BUG`

---

### 8.2 General Admin Request (`reportType: 'admin'`)

**Max Claude follow-ups:** 5

Claude collects a free-form description and extracts:
- Title, description, category, account/farmer affected, urgency, original text

**Admin categories:** Account Management | Farmer Data | Field Operations | Finance | System Access | Other

**Slack channel:** `SLACK_CHANNEL_ADMIN`

---

### 8.3 Change Farmer Phone Number (`reportType: 'changePhone'`)

**Max Claude follow-ups:** 3

**Mandatory fields:**
1. Requester name (JA name) — from session profile
2. Request Date — auto-filled with submission timestamp
3. Farmer Name
4. FG Name
5. Reason for change
6. Old Phone Number
7. New Phone Number

**Slack card format:**
```
@Meisisko — Change Phone Number Request
─────────────────────────────────
Report No: ADM-xxx  |  Request Type: Change Phone Number
Requester: [JA Name]  |  Area: [area]
Request Date: [WIB date]  |  Reporter Email: [zohoEmail]
─────────────────────────────────
Farmer Name: [...]  |  FG Name: [...]
Reason To Change: [...]
Old Phone Number: [...]  |  New Phone Number: [...]
─────────────────────────────────
Original: [exact user text]
[timestamp | phone | area]
```

Always pings `@Meisisko` — no keyword guessing needed since this is a dedicated type.

**Slack channel:** `SLACK_CHANNEL_ADMIN`

---

### 8.4 Credit Limit Top-Up (`reportType: 'creditTopUp'`)

**Flow:** Bot sends a web form link and resets the session immediately. No AI interview in chat.

- Standard (<2.5 ha): `{APP_URL}/credit-limit?type=standard`
- Large Farmer (>2.5 ha): `{APP_URL}/credit-limit?type=largeFarmer`

Form submission hits `POST /api/credit-limit/submit` (in `server/routes.ts`), which:
1. Appends a row to Google Sheets (`request!` tab)
2. Posts a Slack card to `SLACK_CHANNEL_CREDIT_LIMIT`
3. Sends WATI confirmation to the reporter

The `flows/creditLimitTopUp.ts` and credit prompt in `claude-agent.ts` are legacy — not used in the current chat flow.

**Slack channel:** `SLACK_CHANNEL_CREDIT_LIMIT` (falls back to `SLACK_CHANNEL_ADMIN`)

---

## 9. Claude AI Integration

**File:** `server/bot/services/claude-agent.ts`

**Model:** `claude-sonnet-4-5` (NOT `claude-sonnet-4-20250514` — date-suffix format is invalid for Claude 4)
**Max tokens:** 1024
**Client:** Lazy-initialized from `ANTHROPIC_API_KEY`

### System Prompt Architecture

Each report type has its own dedicated system prompt (`buildSystemPrompt`):
- `'bug'` — QA assistant, structured JSON with all mandatory/conditional fields
- `'admin'` — Admin assistant, free-form description collection
- `'changePhone'` — Phone change specialist, 5-field structured collection
- `'creditTopUp'` — Legacy, not used in current flow

### Response Format (all types)

Claude must always return **valid JSON only** (no markdown, no backticks):

```json
{
  "status": "need_more_info" | "ready",
  "followUpQuestion": "Indonesian --- English (bilingual, only if need_more_info)",
  "parsedReport": {
    "title": "[Category] Short English summary",
    "description": "Professional English translation",
    "stepsToReproduce": "...",
    "pgName": "...",
    "farmerName": "...",
    "invoiceNumber": "...",
    "invoiceType": "mechanization | agri input | advisory | null",
    "invoiceCurrentNumber": "...",
    "invoiceNewNumber": "...",
    "platform": "Android | iOS | Web",
    "appVersion": "...",
    "errorDetails": "exact text | - | null",
    "category": "...",
    "additionalInfo": "...",
    "originalText": "exact original user text"
  }
}
```

**Language rules:**
- `followUpQuestion` → **always bilingual**: Indonesian first, `---` separator, then English
- All `parsedReport` fields → **professional English only** (translate from Indonesian/Vietnamese)
- `originalText` → **preserve exactly** as typed by user

### Parsing & Fallback

1. Regex extracts first `{...}` block from Claude response
2. `JSON.parse()` that block
3. If at hard follow-up limit → force `status: "ready"` regardless of what Claude says
4. If API key missing / API error → returns `{ status: 'ready', parsedReport: { title: 'Manual Review Required', ... } }`

### Conversation Format

`buildMessages()` converts `ConversationMessage[]` to Anthropic `user`/`assistant` alternating turns. Media URLs are represented as text markers (not actual image blocks sent to Claude).

---

## 10. Slack Integration

**File:** `server/bot/services/slack.ts`

### Posting

- Uses Slack Web API (`chat.postMessage`) via `SLACK_BOT_TOKEN` when both token and channel ID are set
- Falls back to incoming webhook (`SLACK_WEBHOOK_BUG` / `SLACK_WEBHOOK_ADMIN`) if no bot token/channel
- `postToSlack` captures `message_ts` and `channel` from the response for threading

### Card Builders

| Builder | Report Type |
|---|---|
| `buildBugReportBlocks()` | Bug reports |
| `buildAdminRequestBlocks()` | General admin requests |
| `buildChangePhoneBlocks()` | Change phone number requests |
| `buildCreditLimitBlocks()` | Credit limit top-up (exported, used by routes.ts) |

Bug cards include:
- Reporter info, area, report number
- PG/Farmer/Invoice line
- Invoice details block (if present): invoice number, type, current/new number
- Description, steps to reproduce
- App version, platform
- Error details (code block if present)
- P0 priority badge (auto-detected by keyword scan)
- Media count line
- Timestamp | phone | area footer

### Media Upload

`uploadFileToSlack()` pipeline:
1. Download WATI media URL using WATI Bearer token (timeout: 60s, max 50MB)
2. Call `files.getUploadURLExternal` to get Slack upload URL
3. PUT binary to the upload URL
4. Call `files.completeUploadExternal` targeting the report thread

All media is uploaded as **thread replies** on the main report card.

### Reactions & Thread Replies

- Bot can add reactions to Slack messages (e.g., priority emojis)
- Slack listener in `routes.ts` handles `reaction_added` events to trigger status updates

---

## 11. Report Numbering

**File:** `server/bot/services/reportCounter.ts`

Format: `YYYYMMDD-TYPE-N`
- `YYYYMMDD` — date in `Asia/Jakarta` timezone
- `TYPE` — `BUG`, `ADM`, or `CRD`
- `N` — sequential integer per day per type, starting at 1

Implementation:
- Reads/increments from `counters` tab in Google Sheets
- Per-date/type in-process lock to prevent race conditions
- If no row exists for today+type → creates one starting at 1

Examples: `20260804-BUG-12`, `20260804-ADM-3`

---

## 12. Report Registry

**File:** `server/bot/services/reportRegistry.ts`

Backed by `reports_registry` tab in Google Sheets.

Lifecycle:
1. On submission → `appendEntry(PENDING, ts, channel, number, phone, name, type, createdWIB)`
2. On Slack approval/rejection → `markResolved(ts, resolvedTimestamp)`

Also used to look up existing reports by Slack `message_ts`.

---

## 13. Slack Message Mapping (Postgres)

**File:** `server/bot/services/slack-map-db.ts`

Postgres table `slack_mappings`:

| Column | Description |
|---|---|
| `key` | `channelId:messageTs` |
| `report_number` | e.g. `20260804-ADM-3` |
| `phone` | Reporter phone |
| `name` | Reporter name |
| `type` | `bug | admin` |
| `created_at` | Timestamp |

- Pruned automatically for entries older than **30 days**
- Used by Slack listener to correlate incoming reactions/replies with the original reporter

---

## 14. Google Sheets Structure

**Spreadsheet ID:** `GOOGLE_SHEETS_ID` env var

| Tab | Purpose |
|---|---|
| `counters` | `date | type | last_number` — report number tracking |
| `reports_registry` | Full report lifecycle log |
| `request` | Credit limit top-up form submissions (columns A–Y) |
| `Farmer Database` | FG → farmer name lookup (read-only reference) |

Auth: OAuth token fetched via Replit Google connector (`google-sheet`), cached in memory.

---

## 15. Key Configuration Constants

| Constant | Value | Location |
|---|---|---|
| Session TTL | 30 minutes | `session.ts` |
| Session cleanup interval | 5 minutes | `session.ts` |
| Slack mapping prune age | 30 days | `slack-map-db.ts` |
| Activity log max entries | 100 | `activityLog.ts` |
| Max Claude follow-ups (bug) | 5 | `router.ts` + `claude-agent.ts` |
| Max Claude follow-ups (admin) | 5 | `router.ts` + `claude-agent.ts` |
| Max Claude follow-ups (changePhone) | 3 | `router.ts` + `claude-agent.ts` |
| Max Claude follow-ups (credit standard) | 8 | `claude-agent.ts` (legacy) |
| Max Claude follow-ups (credit large) | 12 | `claude-agent.ts` (legacy) |
| Claude model | `claude-sonnet-4-5` | `claude-agent.ts` |
| Claude max tokens | 1024 | `claude-agent.ts` |
| Media download timeout | 60s | `slack.ts` |
| Max media size | 50MB | `slack.ts` |

---

## 16. Security

| Mechanism | Detail |
|---|---|
| Whitelist | Only agronomists in `agronomist-database.json` can interact with the bot |
| Slack signature | HMAC verification on all inbound Slack events (`SLACK_SIGNING_SECRET`) |
| WATI webhook | No signature verification (trust by endpoint obscurity) |
| Credit form webhook | `x-webhook-secret` header or query param (`SHEET_WEBHOOK_SECRET`) |
| Session secret | `SESSION_SECRET` for Express session middleware |

---

## 17. Bilingual Policy

All user-facing WhatsApp messages from the bot are **bilingual** (Indonesian + English):
- Indonesian text first
- `---` separator
- English text

This applies to: follow-up questions, error messages, confirmation summaries, success/failure notifications.

Exception: `parsedReport` fields stored internally and posted to Slack are **English only**.

---

## 18. End-to-End Flow Example (Bug Report)

```
User: "START"
Bot:  Welcome menu (1 = Bug, 2 = Admin)

User: "1"
Bot:  "Ceritakan bug yang kamu temukan..." / "Describe the bug..."
      → session.step = COLLECTING, reportType = 'bug'

User: "App crash saat buka halaman task, PG Nurhati, Android"
Bot:  "Sedang menganalisis..." → Claude called
      Claude: need_more_info → "Versi app berapa? / What app version?"
      followUpCount = 1

User: "v2.3.1"
Bot:  → Claude called
      Claude: need_more_info → "Bisa share detail errornya? / Error details?"
      followUpCount = 2

User: "Request: POST /tasks/detail Status: 500 Request ID: abc-123"
Bot:  → Claude called (screenshot still missing)
      Claude: need_more_info → "Tolong kirim screenshot... / Please send screenshot..."
      followUpCount = 3

User: [sends image]
Bot:  → Claude called, hasScreenshot = true
      Claude: ready
      → Build confirmation summary
      session.step = CONFIRMING
      Bot sends summary + "KIRIM untuk kirim / ULANG untuk edit"

User: "KIRIM"
Bot:  "Sedang mengirim..."
      → reportCounter: 20260804-BUG-5
      → postToSlack → captures ts, channel
      → uploadFileToSlack (image to thread)
      → reportRegistry.appendEntry
      → slackMapDB.store
      → session.reset()
      Bot: "Bug Report berhasil dikirim! Report: 20260804-BUG-5"
```

---

## 19. Known Behaviors & Edge Cases

- **Duplicate webhook delivery:** WATI occasionally delivers the same message twice. The `isProcessing` lock prevents double-processing within a session, but if the session was just reset between deliveries, both could create sessions. Mitigated by the session creation log.
- **Session mystery disappearance:** Observed once where a session was created and disappeared before the next message (11 seconds later). Diagnostic logging added to `session.ts` to capture future occurrences.
- **Menu reply with no session:** Sending `1`, `2`, or `3` with no active session re-shows the welcome menu (graceful recovery) instead of silently ignoring.
- **Media during processing:** Queued by phone number, flushed after Claude call completes.
- **Hard follow-up limit:** When the max is hit, Claude is forced to `ready` regardless of missing fields — this prevents infinite loops but may result in incomplete reports requiring manual follow-up.
- **Credit top-up chat flow:** The AI-driven credit collection path exists in code but is not wired in the current router — it goes directly to the web form.
