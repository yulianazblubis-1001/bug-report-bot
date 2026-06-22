# Credit Limit Top-Up Feature — Reference Guide

## Overview

A web form that lets Rize.farm agronomists request a credit limit increase for a farmer. The form is triggered from WhatsApp but filled in a browser — combining the convenience of WhatsApp with the structure of a proper data entry form.

---

## User Journey

```
Agronomist sends trigger keyword on WhatsApp
  (BUG / LAPOR / START / MULAI / MENU / REPORT)
        ↓
Bot sends main menu → user replies 2 (Admin Request)
        ↓
Bot sends admin sub-menu → user replies 2 (Credit Limit Top Up)
        ↓
Bot sends credit type sub-menu:
  1 → Standard (lahan < 2.5 Ha)
  2 → Petani Besar / Large Farmer (lahan 2.5–5 Ha)
        ↓
Bot sends a pre-filled URL to WhatsApp:
  https://bug-report-bot.replit.app/credit-limit?phone=628xxx&type=standard
        ↓
Agronomist opens link on phone → fills form → submits
```

---

## Form Types

### Standard (lahan < 2.5 Ha)
- Max 8 follow-up interactions if using chat-based flow
- Required documents depend on Credit Type selected

### Petani Besar / Large Farmer (lahan 2.5–5 Ha)
- Requires additional financial and collateral information
- More documents required
- Max 12 follow-up interactions if using chat-based flow

---

## Form Fields

### Always Required (both types)

| Field | Description |
|-------|-------------|
| FG Name | Nama Farmer Group |
| Farmer Name | Nama petani yang butuh top-up |
| Land Parcel Size (Ha) | Luas lahan terverifikasi |
| Current Credit Limit | Credit limit saat ini (Rupiah) |
| Requested Top-Up | Jumlah top-up yang diminta (Rupiah) |
| Credit Type | Agri Input / Mechanization / Both |
| Reason | Alasan pengajuan top-up |

### Credit Type → Conditional Documents

| Credit Type | Required Documents |
|-------------|-------------------|
| Agri Input | SO Number + Signed SO photo + Farmer holding SO photo |
| Mechanization | Signed Request Letter photo + Farmer holding Request Letter photo |
| Both | ALL documents from both types above |

### Large Farmer Only (additional)

| Field | Description |
|-------|-------------|
| Farmer Income Sources | Sumber pendapatan petani |
| Business Potential | Potensi bisnis |
| Collateral Type | Jenis jaminan |
| Collateral Value | Nilai jaminan |
| Collateral Photo | Foto jaminan |
| Collateral Certificate | Sertifikat/dokumen jaminan |
| Land Ownership Proof | Bukti kepemilikan lahan |
| Credit Limit Request Amount | Jumlah credit limit yang diminta |

### Always Required (all types)
- Survey / TM Photo

---

## Integrations

### 1. Google Drive
- **Purpose:** Store all uploaded document photos
- **Auth:** Replit Google Drive connector (OAuth, never cached)
- **Flow:**
  1. On submit, a subfolder is created inside the configured Drive folder, named after the Request ID
  2. All photos are uploaded in parallel using `Promise.allSettled`
  3. Each uploaded file gets a shareable URL returned
- **Key functions:** `ensureRequestSubfolder()`, `uploadFileToFolder()`, `downloadFromWati()`
- **Config:** `GOOGLE_DRIVE_FOLDER_ID` env var

### 2. Google Sheets
- **Purpose:** Persist all request data for Ops Excellence review and approval workflow
- **Auth:** Replit Google Sheets connector (OAuth, always get fresh client — never cache)
- **Sheet tab name:** `request` (NOT Sheet1)
- **Config:** `GOOGLE_SHEETS_ID` env var

#### Column Structure (A–W, 23 columns)

| Col | Header | Source |
|-----|--------|--------|
| A | Timestamp | Auto (WIB) |
| B | Request ID | Auto UUID (8 chars, uppercase) |
| C | Reporter Name | Session / phone lookup |
| D | Reporter Phone | Session |
| E | FG | Form input |
| F | Farmer | Form input |
| G | Land Size Verified | Form input |
| H | Current Limit | Form input |
| I | Requested Top-Up | Form input |
| J | Credit Type | Form input |
| K | Reason | Form input |
| L | SO Number | Form input (Agri Input only) |
| M | Farmer Source of Income & Potential Business | `;`-separated (Large Farmer only) |
| N | Jenis Jaminan - Nilai Jaminan | `;`-separated (Large Farmer only) |
| O | Doc: Signed SO / Request Letter | Google Drive URL |
| P | Doc: Farmer Holding Document | Google Drive URL |
| Q | Doc: Land Ownership Proof | Google Drive URL (Large Farmer only) |
| R | Doc: Dokumen Jaminan | Google Drive URL (Large Farmer only) |
| S | Status | PENDING → APPROVED / REJECTED → RESOLVED |
| T | Reviewed By | Filled by Ops in Sheet |
| U | Review Date | Auto on status change |
| V | Rejection Reason | Filled by Ops in Sheet |
| W | Slack Message TS | System (used to add reactions and thread replies) |

### 3. Slack
- **Purpose:** Notify Ops Excellence team, drive approval workflow
- **Auth:** `SLACK_BOT_TOKEN` (xoxb-) for Web API
- **Channel:** `SLACK_CHANNEL_CREDIT_LIMIT`
- **Mentions:** `SLACK_MENTION_OPS` (comma-separated Slack user IDs)
- **Card format:** Block Kit — header `🏦 CREDIT LIMIT TOP UP REQUEST`, structured fields, Drive doc links, validation flags
- **Required bot OAuth scopes:** `chat:write`, `reactions:read`, `reactions:write`, `files:write`, `users:read`
- **Bot must be invited** to the credit limit channel

### 4. WhatsApp (WATI)
- **Purpose:** Entry point for the user journey; delivery of form link; approval/rejection notifications
- **Auth:** `WATI_TOKEN` (already includes "Bearer " prefix — do NOT add another)
- **Endpoint:** `WATI_API_ENDPOINT`
- **Key calls:**
  - Send form URL link to agronomist
  - Notify agronomist when APPROVED (with details)
  - Notify agronomist when REJECTED (with rejection reason)
  - Notify agronomist when RESOLVED by engineer

### 5. Google Apps Script (Approval Trigger)
- **Purpose:** Watch the Google Sheet for status changes and trigger the backend
- **How to set up:** Open Sheet → Extensions → Apps Script → paste contents of `google-apps-script.js`
- **Trigger:** `onEdit` — watches column S (index 19, Status column) in the `request` tab
- **On change:** POST to `/sheet-update` with row data
- **Optional security:** `SHEET_WEBHOOK_SECRET` env var for HMAC verification

---

## Approval Workflow (Post-Submission)

```
1. Agronomist submits form
         ↓
2. Backend:
   - Uploads all photos to Google Drive (parallel)
   - Appends row to Google Sheets (Status: PENDING)
   - Posts Slack card mentioning Ops Excellence
   - Saves Slack message TS to Sheet (col W)
         ↓
3. Ops Excellence reviews in Google Sheet
   - Changes Status (col S) to APPROVED or REJECTED
   - Fills Reviewed By (col T) and optionally Rejection Reason (col V)
         ↓
4. Google Apps Script onEdit fires → POST /sheet-update
         ↓
       APPROVED                         REJECTED
          ↓                                ↓
  :git-approved: emoji             :rejected: emoji
  added to Slack card              added to Slack card
  Thread reply tagging             WhatsApp message sent
  engineers                        to agronomist with
                                   rejection reason
         ↓
5. Engineer reacts ✅ or :done: on Slack message
         ↓
6. Backend:
   - Updates Sheet Status to RESOLVED
   - Sets Review Date (col U)
   - Sends WhatsApp notification to agronomist
```

---

## Technical Implementation Notes

### File Upload Optimization
- **Client-side compression:** Images compressed to max 1920px, 82% JPEG quality before upload (prevents proxy-level rejections from large phone photos)
- **Parallel Drive uploads:** All files uploaded simultaneously using `Promise.allSettled` — reduces submission time from ~28s to ~5–8s
- **Multer config:** `maxCount: 20` across all 5 document fields

### Session / Phone Linking
- The form URL includes `?phone=628xxx` — this links the web submission back to the WhatsApp user
- Phone number used to look up agronomist profile (name, area, email) from `agronomist-database.json`
- After submission, WhatsApp notifications go to that phone number

### Request ID
- Auto-generated: 8-char uppercase UUID prefix (e.g. `5B7877C3`)
- Used as the Drive subfolder name and as a reference in Slack

### Report Number
- Format: `YYYYMMDD-CRD-N` (e.g. `20260617-CRD-1`)
- Durable counter stored in Google Sheets `counters` tab
- Columns: A=date (YYYYMMDD), B=type (BUG/ADM/CRD), C=last_number

### Google Sheets Auth Pattern
```typescript
// ALWAYS get a fresh client — tokens expire
const client = await getUncachableGoogleSheetClient();
```
Never cache the Google Sheets or Drive client.

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/pages/credit-limit-form.tsx` | React form UI with client-side compression |
| `server/routes.ts` | `/api/credit-limit/submit` POST endpoint |
| `server/bot/services/google-sheets.ts` | Append/update/find credit limit rows |
| `server/bot/services/google-drive.ts` | Upload docs, create subfolders, set permissions |
| `server/bot/services/slack.ts` | Build and post credit limit Slack card |
| `server/bot/services/wati.ts` | Send WhatsApp notifications |
| `server/bot/router.ts` | WhatsApp menu routing → sends form URL |
| `google-apps-script.js` | Sheet onEdit trigger → POST /sheet-update |

---

## Environment Variables Required

| Variable | Description |
|----------|-------------|
| `GOOGLE_SHEETS_ID` | Google Sheets spreadsheet ID |
| `GOOGLE_DRIVE_FOLDER_ID` | Root Drive folder for document uploads |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (xoxb-) |
| `SLACK_CHANNEL_CREDIT_LIMIT` | Slack channel ID for credit limit cards |
| `SLACK_MENTION_OPS` | Comma-separated Slack user IDs to mention |
| `WATI_API_ENDPOINT` | WATI API base URL |
| `WATI_TOKEN` | WATI Bearer token (already includes "Bearer ") |
| `SLACK_SIGNING_SECRET` | For Slack event verification |
| `SHEET_WEBHOOK_SECRET` | Optional — HMAC secret for /sheet-update |
| `APP_URL` | Production URL used to build form links in WhatsApp |

---

## Checklist — Setting Up From Scratch

- [ ] Create Google Sheet with tab named exactly `request`
- [ ] Add headers in row 1 (cols A–W as per column structure above)
- [ ] Add `counters` tab with headers: Date, Type, Last Number
- [ ] Add `reports_registry` tab
- [ ] Connect Google Sheets and Google Drive via Replit integrations
- [ ] Set all environment variables
- [ ] Invite Slack bot to the credit limit channel
- [ ] Enable Slack Event Subscriptions: `reaction_added`, `message.channels`
- [ ] Paste `google-apps-script.js` into Sheet → Apps Script editor
- [ ] Deploy Apps Script and authorize it
- [ ] Verify webhook URL in Apps Script points to production `/sheet-update`
