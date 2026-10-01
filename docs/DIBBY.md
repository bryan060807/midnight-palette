# Dibby technique coaching

Dibby is a server-backed technique coach layered onto the existing native HTTP app. Curated cards remain available without an AI key. Live coaching and optional progress-photo analysis use the configured provider adapter and the existing daily provider-call budget.

## Local setup

```powershell
cd C:\Users\bryan\aibry\projects\midnight-palette
Copy-Item .env.example .env
# Set APP_PASSWORD for a normal authenticated installation.
# Set OPENAI_API_KEY only in the server-side .env when live help is wanted.
npm test
npm run check
npm start
```

`APP_PASSWORD` is required for live Dibby requests unless the explicit loopback-only developer switch is enabled:

```dotenv
HOST=127.0.0.1
AI_PROVIDER=mock
DIBBY_DEV_MODE=true
```

Never enable `DIBBY_DEV_MODE` on a public bind. It is intended for local mocked-provider development and does not bypass origin checks. `AI_PROVIDER=mock` never calls OpenAI. With no key, the status endpoint truthfully reports live help as unavailable while the technique library remains usable.

## Data model and migrations

The existing `Store` opens one `node:sqlite` connection for the app. Migration `002-dibby` adds:

- `techniques`: normalized medium, skill level, categories, symptoms, surface/tool/material-condition compatibility, explanation, action, practice, questions, cautions, provenance, and review status.
- `technique_resources`: source metadata, teaching summary, review evidence/method, optional validated YouTube ID and reviewed segment bounds, availability, embedding status, and verification date.
- `technique_resource_links`: idempotent many-to-many links when one demonstration supports more than one technique card.
- `technique_feedback`: only the matched technique ID, helped flag, optional short comment, and timestamp.
- `dibby_requests`: bounded idempotency responses so duplicate submissions do not create a second provider call.

Existing `projects`, `requests`, and `usage` rows are not rewritten. Seed inserts use `INSERT OR IGNORE`; rerunning the app does not replace local edits to a technique card. Medium normalization maps `Pencil` to `graphite` and keeps graphite, charcoal, and colored pencil separate.

The library contains 24 technique cards. `resources/dibby-resources.json` adds 19 attributable demonstrations (15 videos and 4 written/embedded demonstrations) with 29 technique links after import. Five manifest records are `verified`; 14 video records remain honest `candidate` records because this environment could not play the third-party videos. The existing four verified manufacturer/article seeds remain intact. After import, the coverage endpoint reports eight cards with at least one reviewed, available demonstration; remaining cards are text-only or candidate-only and are not described as visually verified fixes.

## API

All requests use the existing same-origin and session protections. The live/billable ask route is `POST /api/dibby/ask` and requires an `Idempotency-Key` of 16–100 safe characters. The request accepts a bounded question, optional medium/tutorial context, up to eight bounded conversation messages, and an optional `data:image/png|jpeg|webp;base64,...` progress photo. Remote image URLs are rejected. The server validates the image signature and does not retain the photo or conversation in routine logs.

Other routes:

- `GET /api/dibby/status` — capabilities, card count, live-provider state, privacy notice, and coverage totals.
- `GET /api/dibby/coverage` — per-card `reviewedResources`, `availableResources`, and review status.
- `GET /api/dibby/techniques?q=&medium=` — deterministic curated-card browsing.
- `POST /api/dibby/feedback` — `{techniqueId, helped, comment?}` with a bounded comment.

Retrieval is deterministic and returns up to three compatible cards. Confirmed medium compatibility is required; explicit incompatible surfaces/tools/material conditions are excluded. Unknown medium or material state causes a focused clarification question. Model-returned IDs are accepted only when they occur in the supplied candidate set, and response fields are validated again on the server.

The photo prompt explicitly separates observations from hypotheses. A photo may show an edge, wash, or texture; it cannot establish exact materials, drying time, humidity, or the cause by itself. User and tutorial context is bounded and treated as untrusted subject matter.

## Resource import and review

There is no automatic YouTube search or publication. Import the checked-in curated manifest into an isolated development database first:

```powershell
$isolatedData = Join-Path $env:TEMP ('midnight-palette-dibby-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $isolatedData | Out-Null
$env:DATA_DIR = $isolatedData
node server/dibby-resource-import.mjs .\resources\dibby-resources.json --review
```

The manifest supports `techniqueIds` for justified multi-card associations, `focus`, `teaches`, `reviewEvidence`, `reviewMethod`, optional validated `youtubeId`, optional absolute `startSeconds`/`endSeconds`, `availability`, and `embeddingStatus`. Imports default to `candidate`; the importer validates HTTPS URLs, known resource types, technique IDs, YouTube IDs, nonnegative timestamps, segment order/duration, duplicate IDs, and review evidence. `availability` other than `available` is not returned to Dibby. A record is never upgraded automatically. An operator may explicitly import a record with `reviewStatus: "verified"`, a `YYYY-MM-DD` `lastVerified`, explicit non-metadata review evidence, `embeddingStatus: "embeddable"` for video, and `--review` after independently checking the source:

```powershell
node server/dibby-resource-import.mjs .\reviewed-resources.json --review
```

The exact configured-database command is the same command with the configured data directory selected explicitly; use the normal backup/approval boundary before doing this on a live installation:

```powershell
$env:DATA_DIR = (Resolve-Path .\data).Path
node server/dibby-resource-import.mjs .\resources\dibby-resources.json --review
```

The import is an upsert by resource ID and rewrites only that resource’s technique links. It preserves projects, requests, usage, feedback, and unrelated resources. Re-running the command is idempotent. Do not run it against production without the normal operator approval and backup boundary.

## Review evidence and current gaps

Review methods are deliberately visible: `creator_chapters` means the creator page exposed chapter markers; `transcript` means text evidence was available but the video was not visually played; `metadata` means title/description discovery only; `creator_page` and `manufacturer_page` mean the linked page itself was reviewed. None of the 14 candidate videos in the manifest is labeled visually reviewed. The one verified video segment uses the creator-published 53:00–58:30 chapter bounds; timestamps are absolute video positions, not clip lengths.

The remaining review work is to play the candidate videos in an approved browser, confirm the exact technique and any segment bounds, check per-video embedding permission, and then re-import only records that pass that review. No video was downloaded, rehosted, or cut.

## Runtime refresh

The importer writes SQLite directly; restart the local PM2 process after importing if it keeps a long-lived connection:

```powershell
pm2 restart midnight-palette
```

This task does not perform that restart. Refresh the browser with a hard reload (`Ctrl+F5`) after a frontend asset change. There is no application cache-refresh command and no production restart, deploy, DNS, or database mutation was performed here.

For a later discovery worker, keep the boundary server-side: search only through an approved API, filter embeddable results, cache and quota-limit candidates, enqueue them for review, never invent timestamps, and never turn a search result into a trusted resource automatically.

## Privacy and safety boundaries

- Keys remain in the server `.env`; browser code never sees them.
- Progress photos are bounded, signature-checked, sent only for the current analysis, and not saved under `data/media`.
- Provider errors are sanitized. Calls are counted before dispatch, time out, do not auto-retry, and are concurrency-limited.
- Demonstration DOM is constructed with text nodes. YouTube embeds use the fixed `youtube-nocookie.com` host, no autoplay, and only stored reviewed timestamps.
- This phase does not add AIBRY ID, user accounts, deployment, DNS, arbitrary web search, or text-to-image generation.
