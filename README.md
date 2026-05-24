# FlashLang

A Dutch vocabulary recognition app served from Cloudflare Workers, with D1-backed cross-device progress sync and a Worker TTS proxy.

## Commands

```bash
npm install
npm run generate:deck
npm run dev
npm run dev:worker
npm run build
npm run deploy
```

The app remains local-first: progress is stored immediately in `localStorage`, then merged into Cloudflare D1 when a sync code is configured in settings.

## Cloudflare Setup

```bash
wrangler d1 create flashlang
```

Copy the generated `database_id` into `wrangler.toml`, then configure local development:

```bash
cp .dev.vars.example .dev.vars
npm run d1:migrate:local
npm run dev:worker
```

For production, set `SYNC_CODE` as a Cloudflare Worker environment variable and run:

```bash
npm run d1:migrate:remote
npm run deploy
```

GitHub Actions deployment expects `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Data Sources

- Frequency order: Wiktionary Dutch wordlist based on OpenSubtitles.
- Translations: WikDict Dutch-English SQLite export, derived from Wiktionary/DBnary and licensed under CC BY-SA.
- Pronunciation: browser Web Speech API first, then `/api/tts` through the Worker.
