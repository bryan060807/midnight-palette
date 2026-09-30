# The Midnight Palette — complete self-hosted source

Your new 2am Obsession.

This package combines the published site's mobile layout and Dibby mascot with the earlier Node AI canvas backend and saved-canvas improvements. All artwork, scripts, CSS, tutorial step sheets, server source, and tests are included. No build step, npm dependencies, Sites account, or Sites runtime is required.

## Start on your server

Requires Node.js 24+.

```bash
cd midnight-palette
cp .env.example .env
# Edit .env locally on your server before starting.
npm start
```

The default address is http://127.0.0.1:3000. There is no `npm install` step.

Configuration lives in `.env` next to `package.json`, outside `public/`. The supplied template contains no API key. Set `OPENAI_API_KEY` on your server to enable the existing photo-reference tutorial backend; never put it in frontend JavaScript. Restart after changing configuration.

For a reverse proxy or Cloudflare Tunnel:

- Keep `HOST=127.0.0.1` if the proxy/tunnel runs on the same machine.
- Set `PUBLIC_ORIGIN` to your exact external HTTPS origin, with no path, e.g. `https://art.example.com`.
- Set `APP_PASSWORD` to a unique random password of at least 16 characters even when binding to loopback. This protects the entire self-hosted app, including paid endpoints. Share it only with the intended users.
- Preserve the incoming Host header when proxying; the server validates it against PUBLIC_ORIGIN.
- Terminate HTTPS at your proxy/tunnel. Do not expose an unprotected Node port publicly.
- The included `deploy/nginx.conf.example` shows the relevant proxy settings. Replace its domain and add your normal TLS configuration.

## Feature status

Working code included:

- 36 painting and drawing projects with illustrated steps.
- Pinterest import and image recovery, boards, saved ideas, progress tracking.
- Dark/light themes, Midnight Palette branding, paintbrush logo and mobile reading layout.
- Dibby mascot, practice cards, guided idea briefs saved on the current device.
- Create canvas: upload a reference image, review a lesson plan, generate a final image and six illustrated stages through the OpenAI backend.
- Saved generated canvases, add to board, materials checklists, resume/cancel and provider-call limits.

Not implemented:

- Dibby AI chat, live web technique search, video demonstrations and photo critique.
- Text-only idea-to-image generation from Dibby's briefs.
- AIBRY ID, individual user accounts or per-user data isolation.

Dibby's tips and brief builder are local scripted features, not AI responses. Adding a key enables the existing canvas-generation backend; it does not enable those unfinished features.

The backend is a single shared workspace. APP_PASSWORD protects the entire app, not just generation. This is different from the public library/private AI split discussed for Sites. Do not publish the backend without access protection.

## Running as a service

Foreground: `npm start`.

PM2, if already installed:

```bash
pm2 start npm --name midnight-palette -- start
pm2 save
```

Run those commands from this package directory. Configure PM2 startup separately for your server if needed.

Alternatively, the included Dockerfile and compose.yaml run the same app. Set `.env` first, including APP_PASSWORD and PUBLIC_ORIGIN, then run `docker compose up -d --build`. The compose file publishes only to loopback and stores data in a named volume.

## Data and moving from the laptop

- Generated projects and images are under `data/` (or configured DATA_DIR). Stop both app instances before copying an existing data folder. Back it up before any migration.
- Boards and builtin lesson progress use browser storage. Export a workspace backup from the old app and import it on the new origin. Browser storage does not automatically move between laptop, phone, localhost and domain names.
- The server data folder and browser backup are separate. Preserve both.
- This ZIP contains code and bundled art only, not personal projects, existing browser boards, a live database, passwords or keys.

## Exact static Sites version

To host only the same features that were on Sites, copy `public/` into a separate static web root and replace that copy's `index.html` with `docs/static-site-index.html`. Restore `docs/static-dibby.js` as `dibby.js` there too. This removes the backend entry points and preserves the original Dibby wording. Serve that web root with any static HTTP server. Never serve this package root or `.env` as static content.

## Validation

Run `npm test` and `npm run check`. Tests use mocked providers; no paid API calls are made by those tests. This export has not been deployed to your server or tested with your API key. See docs/AI-BACKEND-README.md for the original pipeline documentation.
