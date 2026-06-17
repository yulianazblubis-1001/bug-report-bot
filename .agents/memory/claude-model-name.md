---
name: Claude model name
description: Correct Claude 4 model ID — date-suffix format causes 404 errors
---

## Rule
Always use `claude-sonnet-4-5` as the model ID in `server/bot/services/claude-agent.ts`.

**Why:** The model ID `claude-sonnet-4-20250514` returns a 404 not_found_error. Claude 4 models use a version-number suffix (4-5), not a date suffix. Every API call was failing silently, triggering the error fallback and breaking all bot flows.

**How to apply:** If changing the model, verify the exact ID against Anthropic's models list. Never assume YYYYMMDD suffix works for Claude 4+.
