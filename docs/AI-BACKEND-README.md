# Pinwell Studio — AI Canvas Edition

A complete self-hosted copy of Pinwell, with Pinterest import/image recovery, 36 built-in visual tutorials, and a new server-backed reference-to-painting pipeline.

**Status:** implemented and tested with a mock provider. No real OpenAI requests were made. Model access, billing, runtime latency, and the visual quality/consistency of actual generated lessons still need a first live test after you add a key. This package does not modify the currently hosted ChatGPT Site.

## Run on Fedora / Linux

Install Node.js **24 or newer** using your preferred method. No npm dependencies are needed.

```bash
cd pinwell-source
cp .env.example .env
npm start
```

Open **http://127.0.0.1:3000** (use this exact hostname by default).

## Run on Windows PowerShell

Extract the package, for example under `C:\bryan\pinwell-source`, with Node.js 24+ installed.

```powershell
cd C:\bryan\pinwell-source
Copy-Item .env.example .env
npm start
```

The app opens in setup mode without a key. Existing art tutorials, board organization, imports, and source-image previews remain usable. AI creation is disabled with a clear setup message.

## Connect AI later

Edit the server's `.env` file:

```dotenv
OPENAI_API_KEY=your_key_here
AI_PROVIDER=openai
```

Restart `npm start`. The key stays on the server; do not put it in `public/`, browser storage, or a Git commit. There is no API key included in this archive. The app deliberately does not provide a browser field that asks for your API key.

Defaults are `gpt-4.1` for reference analysis/structured plans and `gpt-image-1.5` for reference-based image editing. Both are configurable in `.env`. Your API project needs access to the chosen models and sufficient credits. Selecting a different model may require adapting supported request parameters in `server/provider.mjs`.

A complete successful project uses **eight provider calls**: one vision planning request, one finished target image, and six progress images. Actual cost varies by model, quality, reference sizes, and retries. The default 40-call UTC daily ceiling is an application guard, **not a dollar budget**. Set an API project spending limit separately. Failed/timed-out attempts count toward the app limit. The app never automatically retries billable provider calls.

## Use it

1. Import your Pinterest pins or upload a reference through **My canvases → New canvas from an image**.
2. Open a pin and choose **Turn into a painting tutorial**.
3. Select medium, difficulty, canvas shape, and any simplification notes.
4. Create the lesson plan. Review its materials, colors, and six steps. Instructions are editable before image generation.
5. Choose **Generate the visual guide**. The job continues if you close its dialog or browser tab while the server remains running.
6. In **My canvases**, open a project to step through images, compare with the finished target or source, and save progress.

For cost and consistency, the finished target is generated first. Every progress image references the source and that target, and steps 2–6 also reference the previous image. This conditions visual continuity; it cannot guarantee it. These are illustrative AI teaching guides, not verified reconstructions of the original artist's technique.

Only `https://i.pinimg.com` thumbnail URLs are fetched by the backend. It rejects redirects and other remote hosts; upload a local PNG/JPEG/WebP (under 8 MB) for other sources. The uploaded reference is sent to OpenAI when planning/generation runs. Pinterest import is not account-level OAuth synchronization and does not access private boards automatically.

## Bring over your existing boards

Your old Pinwell boards live in browser storage on `pinwell.aibry.chatgpt.site`. A localhost app cannot read that storage. Export a workspace JSON backup from the old app's settings and import it into this copy. The same backup format and original organizer are included.

Original boards remain browser-local for compatibility. **New AI projects, their reference images, generated images, and completion progress live in `data/` on the server.** Deleting a source pin does not delete its generated project. This is a single-user installation, not a multi-user account service.

## Storage and backups

- `data/pinwell.sqlite`: projects, job state, request IDs, usage attempts.
- `data/media/<project-id>/`: reference, final target, six generated steps.
- Writes use temporary files and atomic renames; database uses SQLite WAL.
- Stop the app, copy the complete `data/` directory, then restart for a consistent full backup. Restore that folder to the same `DATA_DIR` with the app stopped.
- **Download project** exports one JSON package including base64 image bytes, lesson metadata, and progress. This is a portable developer/archive export; there is no single-project JSON import screen in this version. Full restoration uses the data-directory backup above.
- API keys live separately in `.env`; keep them out of backups you share.

## Queue behavior

One process runs a serial in-process worker backed by durable SQLite checkpoints. Five projects may be queued through the create endpoint. Restarting marks queued/running work **interrupted**, rather than silently creating fresh billable calls. Resume explicitly from the UI. Saved images are reused. A provider may bill an interrupted request even when its result was not saved; resuming that missing result can incur another charge.

Cancellation stops after the current provider request, preserving received images. Graceful server shutdown aborts the active request and marks the job interrupted. Do not run multiple app instances against the same database; for horizontal scaling, replace the queue with a durable distributed worker and object storage.

## Test without a key

Automated integration and provider-contract tests make no external requests:

```bash
npm test
npm run check
```

To exercise the UI manually, set `AI_PROVIDER=mock` in `.env`, then restart. **Mock mode deliberately repeats the uploaded reference as every image and labels projects TEST ONLY.** It tests the flow; it does not generate artwork. Set `AI_PROVIDER=openai` before creating real projects. Existing mock projects remain marked as mock.

The tests cover plan review before images, reference storage, progress persistence, image export, idempotency, failure/resume, cancellation, daily call limits, restart recovery, auth/origin boundaries, and the real adapter's request format using a stubbed HTTP transport.

## Hosting it yourself

For one-machine use, keep `HOST=127.0.0.1` and the default URL. For LAN/tunnel access, set:

```dotenv
HOST=0.0.0.0
PUBLIC_ORIGIN=https://your-domain.example
APP_PASSWORD=a_unique_long_random_password
```

Non-loopback binding requires a password of at least 16 characters. Put a TLS reverse proxy or your tunnel in front of Node, preserve the original Host header, and forward to port 3000. The app uses an HttpOnly, SameSite=Strict session cookie, Secure on HTTPS; sessions expire after 24 hours and clear on restart. It checks Host/Origin to resist DNS rebinding/CSRF, throttles login attempts, and does not trust forwarded identity headers. It is **single-user personal-server architecture**, not a production multi-tenant SaaS authorization system.

A container recipe and compose file are included. The existing ChatGPT-hosted static Site cannot execute this Node/SQLite backend. Deploy this package on a persistent Node host, or port its storage/worker adapters to Cloudflare services before moving it back into Sites.

## Files

- `public/`: complete original app/assets plus `canvas-ai.js` and `canvas-ai.css`.
- `server/index.mjs`: HTTP routes, auth, bounded reference fetching, durable job orchestration.
- `server/provider.mjs`: real OpenAI adapter and explicit mock adapter.
- `server/schema.mjs`: structured-output schema and runtime validation.
- `server/store.mjs`: SQLite persistence and call accounting.
- `test/app.test.mjs`: executable offline integration tests.
- `docs/ARCHITECTURE.md`: API contract, lifecycle, and extension points.

API contracts were checked against the official OpenAI docs on 2026-09-26:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-image-1.5
- https://developers.openai.com/api/docs/guides/image-generation
