# Rize Report Bot — WhatsApp to Slack Reporter

## Overview
A WhatsApp chatbot that guides Rize.farm agronomists through structured bug reports or admin requests. Messages are auto-translated from Indonesian/Vietnamese to English via Claude AI, then posted as formatted Slack cards.

## Architecture
- **Frontend**: React + Vite dashboard at `/` showing bot status, activity logs, configuration, and setup guide
- **Backend**: Express server handling WATI webhooks (`/webhook`), Slack events (`/slack-events`), and API routes (`/api/bot/*`)
- **Bot Engine**: State machine conversation flows in `server/bot/`

## Key Files

### Server / Bot
| File | Purpose |
|------|---------|
| `server/routes.ts` | Express routes: webhook, slack-events, API endpoints |
| `server/bot/session.ts` | In-memory session store with 30-min TTL |
| `server/bot/router.ts` | Message routing + state management |
| `server/bot/activityLog.ts` | In-memory activity log for dashboard |
| `server/bot/flows/bugReport.ts` | Bug report state machine (7 questions) |
| `server/bot/flows/adminRequest.ts` | Admin request state machine (5 questions) |
| `server/bot/services/wati.ts` | WATI API wrapper |
| `server/bot/services/slack.ts` | Slack Block Kit formatter |
| `server/bot/services/translate.ts` | Claude AI translation service |
| `server/bot/whitelist.ts` | Phone number whitelist gate |
| `server/bot/flows/validation.ts` | Shared input validation rules |

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
- `ANTHROPIC_API_KEY` — Claude AI key for translation
- `SLACK_SIGNING_SECRET` — Slack signature verification
- `SESSION_SECRET` — Express session secret
- `WHITELISTED_NUMBERS` — Comma-separated phone numbers (e.g. `628123456789,628198765432`). If empty, all numbers allowed

## How It Works
1. Agronomist sends WhatsApp message via WATI
2. **Whitelist check** — rejects unregistered numbers before any processing
3. Bot asks questions one at a time (state machine)
4. Validates answers (rejects garbage input like `-`, `.`, short text)
5. On submit: translates with Claude AI, posts to Slack
6. Slack team reacts `:done:` / `:solve:` → WhatsApp notification
