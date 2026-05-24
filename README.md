# FlashLang

A Dutch and Mandarin vocabulary recognition app served from Cloudflare Workers, with D1-backed cross-device progress sync and a Worker TTS proxy.

## Commands

```bash
npm install
npm run generate:deck
npm run dev
npm run dev:worker
npm run build
npm run deploy
```

The app remains local-first: progress is stored immediately in `localStorage`, then merged into Cloudflare D1 when a sync code is configured in settings. Sync codes are stored in D1 and must be explicitly allocated before use.

Dutch progress and Mandarin progress are tracked separately. Mandarin uses Simplified Chinese, pinyin with tone marks, and multiple-choice recognition only: Hanzi, pinyin, meaning, and audio can all be prompt/answer surfaces.

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

For production, apply D1 migrations and deploy:

```bash
npm run d1:migrate:remote
npm run sync:allocate -- learn-dutch-chinese
npm run deploy
```

GitHub Actions deployment expects `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Data Sources

### Dutch

- Frequency order: Wiktionary Dutch wordlist based on OpenSubtitles.
- Translations: WikDict Dutch-English SQLite export, derived from Wiktionary/DBnary and licensed under CC BY-SA.

### Mandarin

- Learner staging: HSK 3.0 / Chinese Proficiency Grading Standards.
- Machine-readable vocabulary seed: Complete HSK Vocabulary, MIT licensed.
- Definitions: CC-CEDICT-derived English glosses.
- Frequency metadata: SUBTLEX-CH/HanLP-derived ranking exposed by Complete HSK Vocabulary.

Pronunciation uses `/api/tts` through the Worker.
