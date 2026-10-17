# porotranslator

Discord bot: one-way **Finnish → English** translation between two channels.
Reads a source channel, posts the translation to a dest channel via a webhook
that mimics the original author. English passes through unchanged. Translation
via the OpenAI API.

See [SPEC.md](./SPEC.md) for the full design.

## Setup

1. `cp .env.example .env` and fill in:
   - `DISCORD_TOKEN` — bot token
   - `OPENAI_API_KEY`
   - `GUILD_ID` — the server the bot runs in (slash commands register here)
2. Discord Developer Portal → your app → **Bot** → enable **Message Content
   Intent**. Invite with scopes `bot applications.commands` and permissions
   *Manage Webhooks* + *Send Messages*.

## Run

```bash
npm install          # builds the better-sqlite3 native addon
npm start            # node runs the TypeScript directly (Node 24+)
```

Docker:

```bash
docker compose up -d --build
```

Config persists in SQLite under `./data/` (mounted volume in Docker).
The container runs as uid 1000, so `./data` must be writable by it
(`mkdir -p data && sudo chown -R 1000:1000 data`, also needed when upgrading
from an older image that ran as root and created `config.db` as root).
`docker compose stop` flushes queued messages untranslated (⚠️) before exiting.

## Configure (in Discord, needs Manage Server)

- `/set-source #channel` — where Finnish is read
- `/set-dest #channel` — where English is posted
- `/set-model <id>` — default `gpt-6-luna`; bump to `gpt-6.1-sol` if quality lacks
- `/toggle` — pause/resume without redeploy
- `/status` — show current config

For everyone (no permissions needed):

- `/optout` — the bot ignores your messages: not sent to OpenAI, not reposted
- `/optin` — undo

## Dev

```bash
npm test             # node:test, no framework
npm run typecheck    # tsc --noEmit
```

Pure logic (skip rules, message splitting, preamble stripping), the config
store, and the serial queue are unit-tested. Discord/OpenAI I/O is thin glue
verified at the seams.
