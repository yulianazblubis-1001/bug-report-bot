# Moving the Bug Report Bot off Replit → Railway

A step-by-step, non-technical guide. Follow it in order. Anything marked
**🔑 secret** is like a password — never paste it into GitHub or a public place.

The code has already been made "Replit-free." What's left is: get the code onto
GitHub, create a Google login key, set up Railway, plug in the settings, and
repoint WhatsApp + Slack at the new address.

---

## Overview — what changed in the code

| Before (Replit) | After (anywhere) |
|---|---|
| Google login via Replit's built-in connector | Google login via a **service account key** you create once |
| Secrets stored in Replit's "Secrets" tab | Secrets stored in **Railway's Variables** (and a local `.env` for testing) |
| Database = Replit's built-in Postgres | Database = **Railway's Postgres** (one click) |
| Replit-only helper plugins | Removed |

Nothing about how the bot *behaves* changed — same WhatsApp flow, same Claude
interview, same Slack cards.

---

## Step A — Get the updated code onto GitHub

The changes are on your Mac but not yet on GitHub. Easiest non-technical way:

1. Download **GitHub Desktop**: https://desktop.github.com
2. Open it, sign in with your GitHub account.
3. **File → Add Local Repository**, and choose this folder:
   `rize admin product bot`
4. You'll see a list of changed files on the left. In the box at the
   bottom-left, type a summary like `Migrate off Replit` and click
   **Commit to main**.
5. Click **Push origin** (top bar).

Done — GitHub now has the migrated code. *(Claude can also do this commit for
you if you ask — you'd just click Push.)*

---

## Step B — Create the Google service account (replaces Replit's connector)

This is the one genuinely new piece. It's a "robot Google account" the bot logs
in as. ~10 minutes, one time.

1. Go to https://console.cloud.google.com and sign in with the Google account
   that owns the Sheet/Drive folder.
2. Top bar → project dropdown → **New Project** → name it `bug-report-bot` →
   **Create**. Make sure it's selected afterward.
3. Search bar → type **"Google Sheets API"** → open it → **Enable**.
4. Search bar → type **"Google Drive API"** → open it → **Enable**.
5. Left menu → **APIs & Services → Credentials**.
6. **+ Create Credentials → Service account**.
   - Name: `bug-report-bot`
   - **Create and continue** → skip the optional role → **Done**.
7. You'll see the new service account in the list. Click it → **Keys** tab →
   **Add Key → Create new key → JSON → Create**.
   - A `.json` file downloads. **🔑 This is secret — keep it safe.**
8. Open that JSON file in a text editor and find the line
   `"client_email": "bug-report-bot@....iam.gserviceaccount.com"`.
   **Copy that email address.**
9. Share access with the robot account:
   - Open the **Google Sheet** (ID `1DC9XVBb8h-H-zVABrMOC1dHQ_CtFjyeUBptpc0ag9RM`)
     → **Share** → paste the email → set to **Editor** → Send.
   - Open the **Drive folder** (ID `1YkdwKz7O8pjVnouUVSVE_xzXFL9_6uKr`)
     → **Share** → paste the email → set to **Editor** → Send.

Keep the JSON file handy — you'll paste its contents into Railway in Step D.

---

## Step C — Create the Railway project + database

1. Go to https://railway.app → sign up (use "Login with GitHub" — easiest).
2. **New Project → Deploy from GitHub repo** → pick `bug-report-bot`.
   - Railway starts building. It may fail the first time because settings
     aren't set yet — that's expected, we fix it in Step D.
3. In the project, click **+ New → Database → Add PostgreSQL**.
   - This automatically creates a `DATABASE_URL` the app will use. No setup
     needed; the bot creates its own table on first run.

---

## Step D — Plug in the settings (Variables)

In Railway, click your **service** (the app, not the database) →
**Variables** tab → add each of these (**Raw Editor** lets you paste many at
once).

Copy the secret values from your **Replit project's Secrets tab**.

| Variable | Where to get it | Secret? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Replit Secrets | 🔑 |
| `WATI_API_ENDPOINT` | Replit Secrets | |
| `WATI_TOKEN` | Replit Secrets | 🔑 |
| `SLACK_BOT_TOKEN` | Replit Secrets | 🔑 |
| `SLACK_SIGNING_SECRET` | Replit Secrets | 🔑 |
| `SLACK_CHANNEL_BUG` | `C085L46D50A` | |
| `SLACK_CHANNEL_ADMIN` | `C0766PKUK1N` | |
| `SLACK_CHANNEL_CREDIT_LIMIT` | `C0766PKUK1N` | |
| `GOOGLE_SHEETS_ID` | `1DC9XVBb8h-H-zVABrMOC1dHQ_CtFjyeUBptpc0ag9RM` | |
| `GOOGLE_DRIVE_FOLDER_ID` | `1YkdwKz7O8pjVnouUVSVE_xzXFL9_6uKr` | |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Paste the **entire contents** of the JSON file from Step B (as one value) | 🔑 |
| `SHEET_WEBHOOK_SECRET` | Same value your credit-limit Google Form/Apps Script uses (from Replit Secrets) | 🔑 |
| `NODE_ENV` | `production` | |

> `DATABASE_URL` and `PORT` are provided by Railway automatically — don't add them.
> `APP_URL` we set in the next step, once we know the address.

After saving, Railway redeploys. Watch the **Deployments → Logs**. Success looks
like `serving on port ...`.

---

## Step E — Get the public URL and set APP_URL

1. In Railway → your service → **Settings → Networking → Generate Domain**.
   You'll get something like
   `https://bug-report-bot-production.up.railway.app`.
2. Back in **Variables**, add:
   `APP_URL` = that full URL.
3. Save (it redeploys). Copy the URL — you need it for WATI and Slack next.

---

## Step F — Repoint WhatsApp (WATI) and Slack

The old Replit address is dead now; the outside world must point at Railway.

**WATI (WhatsApp incoming messages):**
1. Log into WATI → your channel's webhook settings.
2. Set the webhook URL to: `https://YOUR-RAILWAY-URL/webhook`
   (replace `YOUR-RAILWAY-URL` with the address from Step E).
3. Save.

**Slack (reactions/approvals coming back):**
1. Go to https://api.slack.com/apps → your app.
2. **Event Subscriptions** → set **Request URL** to:
   `https://YOUR-RAILWAY-URL/slack-events`
   - Slack sends a test — it should show **Verified** (the app must be running).
3. **Interactivity & Shortcuts** → set the Request URL to the same
   `.../slack-events` if it was set before → Save.

**Credit-limit Google Form (if used):**
- In the Apps Script (`google-apps-script.js`), update the target URL to your
  new Railway URL. Ask Claude to help adjust this file if needed.

---

## Step G — Test end-to-end

1. From a whitelisted WhatsApp number, send `START`. You should get the menu.
2. File a quick test bug (send `1`, describe something, attach a screenshot,
   then `KIRIM`).
3. Check: a card appears in the Slack bug channel, the screenshot lands in the
   Drive folder, and a row appears in the Google Sheet.
4. In Slack, react/approve and confirm the reporter gets the WhatsApp update.

If any step fails, open Railway → **Logs** and share the red error lines with
Claude — the logs say exactly what's wrong (usually a missing/typo'd variable).

---

## Notes

- **Old database data:** the bot's Postgres table only holds a rolling 30-day
  list used to match Slack reactions to reports. Starting fresh on Railway is
  fine — only in-flight reports from the last 30 days would lose their
  reaction-linking, which self-heals as new reports come in.
- **Cost:** Railway is roughly $5/month for an app this size.
- **Turning off Replit:** keep the Replit project until Railway is confirmed
  working end-to-end, then you can stop/delete it.
- **Keep the repo Private** on GitHub.
