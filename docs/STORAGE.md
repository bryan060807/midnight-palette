# Private profiles and Fedora storage

`MIDNIGHT_STORAGE=local` is the default and keeps the existing shared-password app and local SQLite/media storage. `MIDNIGHT_STORAGE=postgres` enables two separate AIBRY ID profiles, an editable Profile page, and PostgreSQL persistence for boards, pins, lesson progress, saved ideas, generated canvases and image bytes. The app can remain on the Windows host while the database runs on Fedora.

## Provision before enabling

1. Back up the existing `DATA_DIR` and export browser workspace backups on each device. Keep those backups through migration.
2. Run `npm install` on the app host. Configure `PUBLIC_ORIGIN=https://midnight-palette.aibrylabs.com` and retain the existing unique `APP_PASSWORD` as the invitation password.
3. Provide `MIDNIGHT_DATABASE_URL` through the app's protected server environment, using the Fedora PostgreSQL connection already reachable from the app host. The database role must be allowed to create the `midnight_palette` schema and its tables. Keep the database on the existing private network; do not publish port 5432.
4. Alternatively, set `MIDNIGHT_DATABASE_ENV_FILE` to a protected file containing `DATABASE_URL`. The existing Windows installation defaults to the sibling `canvas-ritual/.env`. `MIDNIGHT_PG_PACKAGE_FILE` optionally points to that sibling's `package.json` to reuse its installed driver; normal app-local `pg` installation is preferred. No credential values belong in Git, frontend code or logs.
5. Register the exact public AIBRY ID client described below on Fedora. Confirm the issuer's authorization, token, userinfo and JWKS routes work before activation.
6. Set `MIDNIGHT_STORAGE=postgres`, or copy `studio-settings.example.json` to the server-only `studio-settings.json` and set its storage value to `postgres`, then restart the app through its normal service manager. Startup creates the dedicated schema and copies older canvases. A database failure stops startup rather than silently falling back to an empty local studio.

Required AIBRY ID client:

| Setting | Value |
| --- | --- |
| Issuer | `https://id.aibrylabs.com` |
| Client ID | `midnight-palette-public-web` |
| Type / token authentication | Public / none |
| PKCE | Required, S256 |
| Redirect URI | `https://midnight-palette.aibrylabs.com/auth/aibry-id/callback` |
| Scopes | `openid profile email` |

`deploy/register-midnight-client.mjs` registers only this client against the existing AIBRY-Auth schema. It reads the Auth service's protected database configuration on Fedora, uses that project's installed PostgreSQL driver, and refuses an existing client with incompatible security settings. Review its fixed project paths against the host installation. `midnight-palette-setup.service` is an optional one-shot user unit for running it through an approved service workflow; it has no enable/start side effect merely by being present in this repo. Registration does not rebuild or restart AIBRY ID. Restart `aibry-auth.service` after registration: the current identity provider loads its registered-client list at startup. Use the Admin bridge's allowed service operations when deploying through Garage Admin.

The settings JSON accepts only the non-secret storage mode. Environment `MIDNIGHT_STORAGE` overrides it. Keep credentials in protected server configuration; the settings file is ignored by Git and is never served from `public/`. Invalid settings stop startup. To roll back through this file, set storage to `local` and restart.

## First sign-in and migration

Each artist opens the app's sign-in page, expands **Connect a new profile**, enters the existing invitation password, and then chooses **Sign in with AIBRY ID**. Existing profiles can subsequently sign in directly with AIBRY ID. The server stores the immutable identity subject as the owner and permits at most two profiles. An invitation is required to enroll any new identity.

Older browser data stays untouched under its original storage keys. Profile offers **Import older browser boards** on the device holding that data. New browser caches are scoped to the signed-in identity. A profile never automatically adopts another profile's browser cache.

At startup, older SQLite canvases and available media are copied idempotently to PostgreSQL without an owner. Profile lists their titles for explicit import; the first successful claim assigns a canvas to that profile. Old local files are preserved. Decide which artist owns each older canvas before importing it.

## Saving and recovery

Workspace saves use a version check. If another device saves first, automatic writes stop and Profile offers a choice between the saved workspace and the device draft. Loading the saved workspace downloads the device draft first. Keeping the device version requires an explicit confirmation. Failed saves keep a dirty draft in the identity's browser cache and retry after reconnecting. Sign-out waits for outstanding saves and refuses to leave while a draft cannot be saved.

Back up the PostgreSQL database with the server's existing backup process, including the `midnight_palette` schema and image bytes. Continue backing up `DATA_DIR` for the technique catalog, provider budget records and Dibby request records. The browser backup covers the workspace; it is not a replacement for the database backup of generated images.

To roll back, stop the app and set `MIDNIGHT_STORAGE=local`. The original local files and browser keys remain available. Data created in PostgreSQL mode does not copy back automatically; preserve the database and export workspace drafts before switching.

## Verification

Run `npm run check` and `npm test` before deployment. The regression suite uses mocked providers; storage HTTP tests use an injected adapter and browser sync tests use a VM. They verify ownership boundaries, conflict handling, device cache isolation, offline retry, and save-before-sign-out behavior without paid requests.

Live verification still requires the real Fedora database and AIBRY ID: check `/health` reports `storage: "fedora-postgresql"` and `databaseReady: true`; enroll both profiles; confirm a board follows its owner onto another device; confirm the other profile cannot read its canvas, media or export; and test a conflicting edit. Check the mobile header and Profile dialog on the actual phone. Repository tests alone do not establish that provisioning or live sign-in succeeded.
