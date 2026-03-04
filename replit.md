# Rize Report Bot — WhatsApp to Slack Reporter

## Overview
A WhatsApp chatbot that guides Rize.farm agronomists through bug reports or admin requests using Claude AI conversational agent. The bot speaks casual Indonesian, enforces mandatory fields, asks intelligent follow-up questions (max 3), translates to English, and posts professional Slack cards with `[Category] Title` format.

## Architecture
- **Frontend**: React + Vite dashboard at `/` showing bot status, activity logs, configuration
- **Backend**: Express server handling WATI webhooks (`/webhook`, `/api/bot/webhook`), Slack events (`/slack-events`), and API routes (`/api/bot/*`)
- **Bot Engine**: Claude AI conversational agent in `server/bot/` — no rigid state machine

## Key Files

### Server / Bot
| File | Purpose |
|------|---------|
| `server/routes.ts` | Express routes: webhook, slack-events, API endpoints |
| `server/bot/session.ts` | In-memory session store with 30-min TTL, conversation history |
| `server/bot/router.ts` | Message routing + conversation flow (SELECT_TYPE → COLLECTING → CONFIRMING) |
| `server/bot/activityLog.ts` | In-memory activity log for dashboard |
| `server/bot/services/claude-agent.ts` | Claude Sonnet 4 agent — evaluates reports, enforces mandatory fields, extracts structured data |
| `server/bot/services/wati.ts` | WATI API wrapper (sendSessionMessage with query param) |
| `server/bot/services/slack.ts` | Slack Block Kit formatter — professional [Category] Title cards |
| `server/bot/whitelist.ts` | Phone whitelist from agronomist database |
| `server/bot/agronomist-database.json` | 70 agronomist profiles (name, area, email, phone) |

### Frontend
| File | Purpose |
|------|---------|
| `client/src/pages/dashboard.tsx` | Main dashboard page |
| `client/src/App.tsx` | App router |

### Shared
| File | Purpose |
|------|---------|
| `shared/schema.ts` | TypeScript types (BotStatus, ReportLog) |

## Slack Card Format
- Title: `[Category] Short English summary` (no emojis)
- Categories: App Bug, Farmer Data, Payment, Field Task, Account, Carbon/AWD, UI/UX, Admin Request, Other
- Fields: Reporter, Category, PG/Farmer, Description, Steps to Reproduce, App Version, Platform, Additional Info, Original text, Screenshots
- Screenshots use Slack `image` block type for inline rendering
- Timestamp/phone/area in footer context block

## Mandatory Fields (Bug Reports)
- Always required: PG Name, Steps to Reproduce, App Version, Platform, Screenshot/Video
- Conditional (payment issues): Farmer Name, Invoice Number
- Payment keywords: payment, bayar, pembayaran, invoice, collect money, collection, tagihan, transfer, uang, cash

## Environment Variables
- `WATI_API_ENDPOINT` — WATI API base URL
- `WATI_TOKEN` — WATI Bearer token
- `SLACK_WEBHOOK_BUG` — Slack webhook for bug reports (fallback)
- `SLACK_WEBHOOK_ADMIN` — Slack webhook for admin requests (fallback)
- `SLACK_BOT_TOKEN` — Slack Bot User OAuth Token (xoxb-) for Web API posting + reaction events
- `SLACK_CHANNEL_BUG` — Slack channel ID for bug reports (C085L46D50A)
- `SLACK_CHANNEL_ADMIN` — Slack channel ID for admin requests (needs setup)
- `ANTHROPIC_API_KEY` — Claude AI key for conversation agent
- `SLACK_SIGNING_SECRET` — Slack signature verification
- `SESSION_SECRET` — Express session secret

## Slack Integration
- Primary: Uses Slack Web API (`chat.postMessage`) with `SLACK_BOT_TOKEN` + channel IDs for posting — returns message `ts` for reaction mapping
- Fallback: Uses incoming webhooks if bot token/channel not configured (no reaction mapping)
- Slack Events endpoint: `/api/bot/slack-events` and `/slack-events` — handles `reaction_added` events
- Reactions: `:done:` and `:solve:` emoji reactions trigger WhatsApp notification to the reporter
- Bot needs OAuth scopes: chat:write, reactions:read, files:write
- Bot must be invited to both channels in Slack

## How It Works
1. Agronomist sends WhatsApp message via WATI
2. Whitelist check — rejects unregistered numbers, auto-identifies from database
3. User picks Bug Report (1) or Admin Request (2)
4. Claude AI evaluates the description, enforces mandatory fields, asks follow-ups (max 3) in Indonesian
5. When ready, shows summary for confirmation (KIRIM to submit, ULANG to restart)
6. On submit: posts professional Slack card with [Category] title and full profile
7. Slack team reacts → WhatsApp notification to reporter

## Technical Notes
- WATI sendSessionMessage uses query param `messageText`, not JSON body
- Webhook registered at both `/webhook` and `/api/bot/webhook` for routing reliability
- Claude Sonnet 4 for conversation evaluation, with fallback if API unavailable
- Router passes `hasScreenshot` flag to Claude so it knows if screenshot requirement is met
- Max 3 follow-ups enforced at both prompt level and router logic
- Sessions auto-expire after 30 minutes of inactivity
