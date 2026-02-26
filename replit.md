# Rize Report Bot — WhatsApp to Slack Reporter

## Overview
A WhatsApp chatbot that guides Rize.farm agronomists through bug reports or admin requests using Claude AI conversational agent. The bot speaks casual Indonesian, asks intelligent follow-up questions (max 3), translates to English at submit time, and posts enriched Slack cards with full agronomist profiles.

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
| `server/bot/services/claude-agent.ts` | Claude Sonnet 4 agent — evaluates reports, asks follow-ups, extracts structured data |
| `server/bot/services/wati.ts` | WATI API wrapper (sendSessionMessage with query param) |
| `server/bot/services/slack.ts` | Slack Block Kit formatter with reporter profile cards |
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

## Environment Variables
- `WATI_API_ENDPOINT` — WATI API base URL
- `WATI_TOKEN` — WATI Bearer token
- `SLACK_WEBHOOK_BUG` — Slack webhook for bug reports
- `SLACK_WEBHOOK_ADMIN` — Slack webhook for admin requests
- `ANTHROPIC_API_KEY` — Claude AI key for conversation agent
- `SLACK_SIGNING_SECRET` — Slack signature verification
- `SESSION_SECRET` — Express session secret

## How It Works
1. Agronomist sends WhatsApp message via WATI
2. **Whitelist check** — rejects unregistered numbers, auto-identifies from database
3. User picks Bug Report (1) or Admin Request (2)
4. Claude AI evaluates the description, asks intelligent follow-ups (max 3) in Indonesian
5. When ready, shows summary for confirmation (KIRIM to submit, ULANG to restart)
6. On submit: posts to Slack with full profile (name, area, email, phone)
7. Slack team reacts → WhatsApp notification to reporter

## Technical Notes
- WATI sendSessionMessage uses query param `messageText`, not JSON body
- Webhook registered at both `/webhook` and `/api/bot/webhook` for routing reliability
- Claude Sonnet 4 for conversation evaluation, with fallback if API unavailable
- Max 3 follow-ups enforced at both prompt level and router logic
- Sessions auto-expire after 30 minutes of inactivity
