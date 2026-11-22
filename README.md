# S.A.R.A. Bot (Smart Assistant for Reminders & Actions)

A personal AI assistant on Cloudflare Workers + D1 (`sara-db`) + Claude (Anthropic API), controlled through Telegram.

## Features
- Send any message (English, Bangla, Banglish) and Claude extracts **tasks** and **decisions** into the database. Duplicates are skipped.
- Replies in the same language you write in (English by default).
- Repeating tasks: "every day / every week / every month". `/done` creates the next one automatically.
- Commands: `/tasks`, `/done <id>`, `/edit <id> <title>`, `/due <id> <date>`, `/delete <id>`, `/decisions`, `/report`, `/help`
- Morning report 08:00 and night report 21:00 (Dhaka time)
- Deadline reminders every 15 minutes (quiet hours 23:00-07:00)

## Structure
```
sara-bot/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── schema.sql
├── migration-step3.sql
└── src/
    ├── index.ts
    ├── claude.ts
    ├── scheduler.ts
    ├── telegram.ts
    ├── dates.ts
    └── types.ts
```

## Setup
1. **Database:** run `schema.sql` in the `sara-db` Console. If the tables already exist, run only `migration-step3.sql`.
2. Put your `database_id` in `wrangler.toml`.
3. Install and deploy:
   ```
   npm install
   npm run typecheck
   npx wrangler deploy
   ```
4. Set these secrets (Dashboard -> Worker -> Settings -> Variables and Secrets, or `npx wrangler secret put NAME`):
   - `TELEGRAM_BOT_TOKEN`
   - `ANTHROPIC_API_KEY` (from https://console.anthropic.com)
   - `ALLOWED_TELEGRAM_USER_ID` (your numeric Telegram ID; get it from @userinfobot)
   - `WEBHOOK_SECRET` (any string of letters, digits, `_` or `-`)
5. Register the webhook by opening this link once in a browser:
   ```
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<WEBHOOK_SECRET>
   ```
   `<WORKER_URL>` looks like `https://sara-bot.<your-subdomain>.workers.dev`.

## If the bot does not respond
1. **Open your Worker URL in a browser.** It shows a status page. Every line must say `OK`. Any `MISSING` line is a secret or binding you still need to set. After adding a secret, redeploy.
2. **Check the webhook:** open `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`.
   - `url` empty -> you have not run step 5.
   - `last_error_message` shows 401 or 500 -> `WEBHOOK_SECRET` is missing on the Worker, or differs from the `secret_token` you registered.
3. **Wrong user ID:** if `ALLOWED_TELEGRAM_USER_ID` is not your ID, the bot silently ignores you.
4. **Error message in chat:** run `npx wrangler tail` and send a message to see the real error. Common causes: wrong `ANTHROPIC_API_KEY` or no API credit, or the `recurrence` column missing (run `migration-step3.sql`).

## Changing the model
Edit `CLAUDE_MODEL` in `wrangler.toml`. Default is `claude-haiku-5-5` (fast, cheap). Use `claude-sonnet-5-5` for more accurate extraction.
