# porotranslator

Discord bot bridging a Finnish and an English channel. Messages in the source
(Finnish) channel are translated **Finnish → English** and posted to the dest
channel via a webhook that mimics the original author; English passes through
unchanged. Messages in the dest (English) channel are forwarded to the source
channel as-is, the same way. Attachments are carried over in both directions.
Translation via the OpenAI API.

The translation prompt is tuned for a Finnish [Riftbound](https://riftbound.leagueoflegends.com)
TCG community (game terms stay in English). For another community, edit
`SYSTEM_PROMPT` in `src/translate.ts`.

## Behavior

- **⚠️ prefix** = forwarded untranslated: the API failed or timed out, the reply
  was truncated, or a cost guard kicked in (over 30 translations/user/minute,
  or 50+ queued). Check the logs for which.
- Messages with nothing to translate (only mentions, emoji, links, attachments)
  skip the API. Mentions never ping on reposted copies.
- Attachments over the server's upload limit are posted as links (expire ~24h).
  Stickers, edits, deletes and reply context are not carried over.
- Bots and webhooks are ignored in both channels (this also prevents loops).
- Each direction has its own queue and keeps its order; past 200 queued, new
  messages are dropped (flood guard).

## Setup

1. `cp .env.example .env` and fill in:
   - `DISCORD_TOKEN` — bot token
   - `OPENAI_API_KEY`
   - `GUILD_ID` — the server the bot runs in (slash commands register here)
2. Discord Developer Portal → your app:
   - **Bot**: enable **Message Content Intent**. To keep the bot private, turn
     off **Public Bot** (first set **Installation → Install Link** to *None*,
     or Discord refuses to save).
   - **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`;
     permissions *View Channels*, *Send Messages*, *Manage Webhooks*. Open the
     URL and pick your server (needs Manage Server, and the permissions you grant).
3. `GUILD_ID`: enable Developer Mode (User Settings → Advanced), right-click the
   server → **Copy Server ID**.

## Run

```bash
npm install          # builds the better-sqlite3 native addon
npm start            # node runs the TypeScript directly (Node 24+)
```

Docker (detached, auto-restarts on crash/reboot via `restart: unless-stopped`):

```bash
npm run prod         # = docker compose up -d --build; logs: docker compose logs -f
```

Dev (separate compose project, foreground, no auto-restart; `.env.dev` overrides
`.env`, e.g. a dev bot token, test `GUILD_ID` and `DB_PATH=./data/dev.db`):

```bash
npm run dev
```

Config persists in SQLite under `./data/` (mounted volume in Docker).
The container runs as uid 1000, so `./data` must be writable by it
(`mkdir -p data && sudo chown -R 1000:1000 data`, also needed when upgrading
from an older image that ran as root and created `config.db` as root).
`docker compose stop` flushes queued messages untranslated (⚠️) before exiting.

## Configure (in Discord, needs Manage Server)

- `/set-source #channel` — the Finnish channel (read and translated; receives forwards)
- `/set-dest #channel` — the English channel (receives translations; forwarded back)
- `/set-model <id>` — default `gpt-6-luna`; bump to `gpt-6.1-sol` if quality lacks
- `/toggle` — pause/resume without redeploy
- `/status` — show current config

The bot needs View Channel and Manage Webhooks in both channels (checked on
`/set-*` and logged at startup).

For everyone (no permissions needed):

- `/optout` — the bot ignores your messages: not sent to OpenAI, not reposted
- `/optin` — undo

## Dev

```bash
npm test             # node:test, no framework
npm run typecheck    # tsc --noEmit
```

Pure logic (routing, message splitting, preamble stripping, rate limiting,
translatable-text detection), the config store and opt-outs, and the serial
queue are unit-tested. Discord/OpenAI I/O is thin glue verified manually —
see [`test/messages.md`](./test/messages.md) for a message checklist.

## License

[MIT](./LICENSE)
