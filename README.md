# Digital Signature Tool — HTTPS with OpenSSL CA Chain

A browser-based tool for creating and verifying digital signatures. All cryptographic operations run entirely in the browser — private keys never leave your machine.

The app runs over HTTPS using a proper 3-tier PKI: Root CA → Intermediate CA → Server certificate, all generated locally with OpenSSL. Importing the Root CA into your OS trust store gives a genuine green padlock with no browser warnings.

## Quick start

**You need:** [Node.js](https://nodejs.org/) 22 LTS or newer (`node --version` to check) and, on Windows, [Git for Windows](https://git-scm.com/) (it provides the `bash` and `openssl` used to create the HTTPS certificates). macOS and Linux already have both.

Get the code and open a terminal in its folder:

```bash
git clone https://github.com/xpr-nfrw-ra/digital-signature-tool.git
cd digital-signature-tool
```

Then:

| Step | Command | Windows shortcut |
|---|---|---|
| 1. Set up (first time only) | `npm run setup` | double-click `setup.bat` |
| 2. Trust the certificate (first time only) | see [Trust the certificate](#trust-the-certificate) | |
| 3. Start the app | `npm run dev` | double-click `start.bat` |
| 4. Open it | **https://localhost:3443** | |

Register an account (or continue as a guest) and you're in. To stop the app, press **Ctrl+C** in its window (`start.bat` then asks *Terminate batch job (Y/N)?* — press **Y**).

Next time, only step 3 is needed. After a `git pull`, also just start the app: new database changes are applied automatically.

## Features

- **File Signing** — sign any file with an RSA or ECDSA private key (client-side; logged to your audit history when signed in). The algorithm is taken from the key itself. The `.sig` file is a self-describing JSON envelope `{ v, alg, hash, sig }`, so verifiers don't need to match the signer's settings.
- **Signature Verification** — verify a file against a public key, either uploaded or looked up server-side. RSA or ECDSA is detected from the public key; the hash is auto-filled (and locked) from the `.sig` envelope, and for legacy raw-base64 signatures the user picks it for that single verification without touching their saved settings.
- **Key Generation** — generate RSA (2048 / 3072 / 4096 bits) or ECDSA (P-256 / P-384 / P-521) key pairs; the public half is auto-registered for logged-in users
- **Standard formats** — keys are PEM (PKCS#1/PKCS#8 private, SPKI public); RSA signatures are PKCS#1 v1.5 and ECDSA signatures are DER, so both verify with OpenSSL, e.g. `openssl dgst -sha256 -verify pub.pem -signature sig.bin file` after base64-decoding the `sig` field. RSA uses forge.js; ECDSA uses the browser's Web Crypto API.
- **Public Key Directory** — a user can register multiple public keys; verifiers look them up by exact username (returns all of that user's keys) or by fingerprint (returns the single matching key).
- **Signing History** — Settings → "Signing History" lists the files you signed while logged in (name, time, key, hash algorithm), 20 at a time with "Load more".
- **Who signed this file?** — on the verify page, picking a file looks it up in the signing log under all three hash algorithms and lists every recorded signer (deleted accounts shown as such). After a valid verification, the signer whose key you just verified with is highlighted. Logged-in users only.
- **Preferred Public Key** — Settings → "My Public Keys" lists all of a user's registered keys with a radio-button picker for the preferred one. Stored in `user_settings.default_public_key_id`; it is a personal bookmark only — it does not hide or restrict which of your keys others can find.
- **User Accounts & Settings** — session-based auth (sessions persisted across restarts); per-user crypto preferences saved server-side
- **Guest Mode** — use signing/verification without an account

## Running the app

### Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app. Restarts it automatically whenever you save a file in `server/` — use this while developing. Changes in `public/` need only a browser refresh. |
| `npm start` | Starts the app without auto-restart. |
| `npm test` | Runs the automated tests (no server or certificates needed). See [Running tests](#running-tests). |
| `npm run db` | Opens Prisma Studio at <http://localhost:5555> to browse or edit the database. Stop it with Ctrl+C. |
| `npm run setup` | Runs setup again — needed only if you deleted `.env` or `certs/`. Safe to re-run; finished steps are skipped. |

Before starting, `npm run dev` and `npm start` check that setup was done (and tell you if not) and apply any new database migrations.

**Debugging in VS Code:** open *Run and Debug* (Ctrl+Shift+D), pick **Start server (debug)** and press F5. Breakpoints in `server/` then work. **Run tests (debug)** does the same for the test suite.

### Trust the certificate

The app uses its own certificate authority, created by setup in `certs/`. Until your computer trusts it, the browser shows a "connection is not private" warning. Do this once:

**Windows** — in PowerShell, from the project folder (Chrome and Edge use this automatically):

```powershell
Import-Certificate -FilePath .\certs\rootCA.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Click **Yes** when Windows asks to confirm. (Or by hand: `Win + R` → `certmgr.msc` → *Trusted Root Certification Authorities* → right-click *Certificates* → *All Tasks* → *Import* → choose `certs\rootCA.crt` → Next → Finish → Yes.)

**Firefox** keeps its own list: Settings → *Privacy & Security* → *View Certificates* → *Authorities* → *Import* → choose `certs/rootCA.crt` → tick *Trust this CA to identify websites*.

Restart the browser afterwards. If you ever delete `certs/` and run setup again, a new authority is created and you need to import the new `rootCA.crt`.

> Keep `certs/rootCA.key` private: while the authority is trusted, anyone with that file could create certificates your computer accepts for any website. It never leaves your machine (`certs/` is gitignored). Remove the authority again in `certmgr.msc` when you stop working on the project.

### Troubleshooting

| You see | Do this |
|---|---|
| *The app is not set up yet: …* | Run `npm run setup` (or double-click `setup.bat`). |
| Browser warning: *Your connection is not private* | [Trust the certificate](#trust-the-certificate), then restart the browser. |
| `EADDRINUSE` … `3443` | The app is already running in another window. Use that one, or close it first. |
| Setup stops with *"bash" was not found* | Install [Git for Windows](https://git-scm.com/), open a new terminal, run setup again. |
| *Node.js … is too old* | Install Node.js 22 LTS or newer. |
| You want an empty database | `npx prisma migrate reset` — **deletes all data**, then recreates the tables. |

### What setup creates

All of these stay on your machine and are gitignored.

| Item | Purpose |
|---|---|
| `node_modules/` | Installed dependencies (`npm install`, which also builds the Prisma client). |
| `.env` | Settings, copied from `.env.example`: `DATABASE_URL` (default `file:./dev.db`) and a random `SESSION_SECRET` that signs session cookies. The server refuses to start without a secret of at least 32 characters. To make one by hand: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `dev.db` | The SQLite database, created and kept up to date by `npx prisma migrate deploy`. |
| `certs/` | The certificate chain made by `scripts/gen-ca-chain.sh` (see below). |

| Certificate file | Description |
|------|-------------|
| `rootCA.key` / `rootCA.crt` | Root CA — self-signed, 10-year validity |
| `intermediate.key` / `intermediate.crt` | Intermediate CA — signed by Root, 5 years |
| `server.key` / `server.crt` | Server certificate for `localhost`, `signtool.local`, `127.0.0.1` — signed by Intermediate, 1 year |
| `chain.crt` | Intermediate + Root bundle sent during the TLS handshake |

## Running tests

```bash
npm test
```

Uses Node's built-in test runner with [Supertest](https://github.com/ladjs/supertest); no server or certificates needed. `scripts/prepare-test-db.js` builds a freshly migrated template database in `test/.tmp/` (gitignored), and each test file works on its own temporary copy, so your `dev.db` is never touched. Tests cover registration/login/logout, session rotation and expiry, rate limits, the `requireAuth` gate, ownership checks, key lookup, settings, the signature log, validators, and the database's on-delete rules.

`test/helpers.js` is the place to start when writing new tests: `registeredClient()` gives you a logged-in user, `registerKey()` a real RSA public key on the server.

## Project Structure

```text
digital-signature-tool/
├── public/                  # Client-side files (HTML, CSS, JS, forge.js)
│   ├── index.html
│   ├── css/
│   ├── js/                  # auth.js, main.js, crypto.js, signing.js, verification.js
│   └── lib/                 # forge.min.js
├── prisma/
│   ├── schema.prisma        # Database schema (users, sessions, signature_log, public_keys, user_settings)
│   └── migrations/          # SQL migration history
├── scripts/
│   ├── setup.js             # npm run setup — first-time setup
│   ├── preflight.js         # Runs before npm start / dev: checks setup, applies migrations
│   ├── gen-ca-chain.sh      # OpenSSL PKI generation script
│   └── prepare-test-db.js   # Builds the migrated template DB for tests
├── server/                  # Node.js/Express backend
│   ├── server.js            # Entry point: loads .env, starts HTTPS (port 3443)
│   ├── app.js               # Express app: middleware + routes (used by server.js and tests)
│   ├── auth.js              # /api/auth/*  (register, login, logout, me)
│   ├── settings.js          # /api/settings  (per-user crypto preferences)
│   ├── keys.js              # /api/keys/*   (register/list/look up/delete public keys)
│   ├── signatures.js        # /api/signatures/*  (audit log)
│   ├── userStore.js         # Prisma/SQLite user storage + shared client export
│   ├── sessionStore.js      # Custom express-session Store backed by Prisma
│   ├── middleware.js        # requireAuth + rate limiters
│   └── validators.js        # Centralized input/length validation
├── test/                    # API and database tests (npm test)
├── dev.db                   # SQLite database — gitignored (created by migrate deploy)
├── certs/                   # Generated certificates — gitignored
├── .env.example             # Template for .env (DATABASE_URL, SESSION_SECRET)
├── .vscode/launch.json      # VS Code debug configurations (F5)
├── setup.bat, start.bat     # Windows double-click shortcuts for npm run setup / npm run dev
├── ROADMAP.md               # Remaining work, open decisions, decision log
└── package.json
```

## API at a glance

All endpoints under `/api`. Sessions are cookie-based; `requireAuth` guards everything except `auth/login`, `auth/register`, `auth/logout`, and the public `auth/me` check.

| Route | Purpose |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Account lifecycle |
| `PUT /auth/username`, `PUT /auth/password` | Change username / password from the Settings → Account card (both require current-password re-confirmation) |
| `DELETE /auth/account` | Delete your account (body `{ currentPassword }`). Soft delete — see "Deleting an account" below |
| `GET /settings`, `PUT /settings` | Per-user crypto preferences |
| `POST /keys`, `GET /keys/mine`, `DELETE /keys/:id` | Manage your own public keys |
| `GET /keys/by-username/:u`, `GET /keys/by-fingerprint/:fp` | Targeted lookup for verification |
| `POST /signatures` | Log a signing event (the key must be yours) |
| `GET /signatures/mine?limit=&cursor=` | Your signing history, newest first. Returns `{ entries, nextCursor }`; pass `nextCursor` back as `cursor` for the next page (`limit` 1–100, default 50; `nextCursor` is `null` on the last page) |
| `GET /signatures/by-hash/:hash?limit=&cursor=` | Everyone who signed the document with this SHA-256/384/512 hash: username, key fingerprint, time (no document names). Same paging as above |

## Database

SQLite via Prisma ORM. [prisma/schema.prisma](prisma/schema.prisma) is the source of truth; every router uses the shared Prisma client exported from `server/userStore.js`. Five tables, all hanging off `users`:

| Table | Holds | Notes |
|---|---|---|
| `users` | `username` (unique), `password_hash` (bcrypt, 10 rounds), `created_at`, `deleted_at` (null unless deleted) | No role column — every user is equal. |
| `sessions` | express-session rows: `id` (= `connect.sid`), `user_id`, `session_data` (JSON), `expires_at` (indexed), `created_at` | A row appears only on login/register (`saveUninitialized: false`). 2-hour sliding idle timeout, refreshed on every authenticated request; expired rows are purged at startup and lazily on read. Deleted on logout. No IP/user-agent stored. |
| `public_keys` | `fingerprint` (unique, SHA-256 of DER SPKI), `public_key_pem`, `label`, `user_id` | A user may have many keys; all are returned by username lookup. |
| `signature_log` | `user_id` (indexed), `public_key_id`, `document_name`, `document_hash` (indexed), `signed_at` | Evidence of a signing event. The signing itself happens in the browser. |
| `user_settings` | `hash_algorithm`, `signature_algorithm`, `key_size`, `default_public_key_id` | 1-to-1 with `users`; defaults inserted on registration. `key_size` is 2048/3072/4096; for ECDSA these mean P-256/P-384/P-521. The default key is only a bookmark — it doesn't restrict lookups. |

**What happens on delete** (declared in the schema, enforced by SQLite):

| Foreign key | On parent delete | Why |
|---|---|---|
| `sessions.user_id` → `users` | CASCADE | Orphaned sessions are a security smell. |
| `user_settings.user_id` → `users` | CASCADE | Settings are meaningless without the user. |
| `user_settings.default_public_key_id` → `public_keys` | SET NULL | Just a bookmark. |
| `signature_log.user_id` → `users` | RESTRICT | The audit trail must outlive an account. |
| `signature_log.public_key_id` → `public_keys` | RESTRICT | A key that signed something can't be silently removed. |
| `public_keys.user_id` → `users` | RESTRICT | Keys may be referenced by the audit log. |

**Deleting an account** is a soft delete, because the RESTRICT rules above (rightly) stop a user row with keys or history from disappearing. In one transaction, `DELETE /api/auth/account`:

- sets `deleted_at`, renames the user to `deleted:<id>` (`:` is not a legal username character, so it can't collide, and the original name is free to register again) and replaces the password hash with a value no password can match;
- deletes the user's settings and **every** session, so other devices are logged out too;
- keeps `public_keys` and `signature_log` rows, so past signatures remain verifiable.

In public lookups (`/keys/by-fingerprint`, `/signatures/by-hash`) a deleted owner appears as `username: null, accountDeleted: true` — the placeholder name is never shown, and a new user who takes the old name inherits nothing. `/keys/by-username` treats a deleted account like an unknown username (empty list), including when queried by its placeholder name. A deleted user's key can't be registered by anyone else.

**Field rules.** SQLite enforces only types, `NOT NULL`, `UNIQUE` and foreign keys — it ignores `VARCHAR(n)` and has no regex. Length and format rules (username 3–32 chars of `[a-zA-Z0-9_.-]`, new passwords 8–128 chars — passwords being checked at login or re-confirmation only need to be non-empty, so accounts created under the old 6-character minimum still work — document hash exactly 64/96/128 hex chars, fingerprint 64 hex, PEM shape, label 1–64 chars, …) live in the `LIMITS` object in [server/validators.js](server/validators.js), which every write route calls before touching the database.

**Changing the schema.** Edit `prisma/schema.prisma`, run `npx prisma migrate dev --name <description>`, then `npx prisma generate` (Prisma 7 no longer regenerates the client during `migrate dev`; `npm test` does it for you), and commit the generated folder under `prisma/migrations/`. Inspect data with `npx prisma studio` or `sqlite3 dev.db`. Application code must go through Prisma (or the parameterized `prisma.$queryRaw`), never hand-built SQL.

## Access control

- **Authentication:** username + password → `bcrypt.compare` → `req.session.regenerate()` (new session ID, prevents fixation) → `req.session.user = { id, username }`. Password change also rotates the session ID.
- **Gate:** `requireAuth` in [server/middleware.js](server/middleware.js) returns 401 for every route except register, login, logout and `me` (which returns its own 401 when there's no session).
- **Ownership:** handlers that touch a row check `row.userId === req.session.user.id` (deleting a key, logging a signature with a key, setting the default key); "mine" routes query by the session user's id.
- **Public lookups:** `/keys/by-username/:u` and `/keys/by-fingerprint/:fp` deliberately return other users' public keys (they're not secret; verification needs them), and `/signatures/by-hash/:hash` returns who signed a given document. Exact match only — there is no list-all endpoint, so you must already know the username, fingerprint or file.
- **Admin access** to the data is out-of-band: whoever can open `dev.db` (sqlite3 / Prisma Studio) has full access.

## Verifying TLS from the command line

```bash
openssl s_client -connect localhost:3443 -CAfile certs/rootCA.crt
```

Look for `Verify return code: 0 (ok)` to confirm the chain validates correctly.

## Security Notes

- Private keys are generated and used entirely in the browser; they are never sent to the server.
- A strict Content Security Policy (helmet, in `server/app.js`) allows scripts, styles and fonts only from the app's own origin — no inline scripts, event-handler attributes or `style=""` attributes, no framing — so injected markup can't run code next to your private keys. Keep new UI code free of inline scripts/styles; `test/security-headers.test.js` checks both the header and the page.
- Passwords are hashed with bcrypt before storage.
- Password-checking endpoints are rate limited: login and register per IP, username/password change per user (only wrong-password attempts count). Limited requests get `429` with a `Retry-After` header.
- Sessions are persisted in SQLite via a Prisma-backed `express-session` store and survive server restarts. Cookies are HTTP-only and secure (HTTPS-only).
- User data is stored in a local SQLite database (`dev.db`). The server stores only public keys, signing-event records, user credentials (bcrypt hashes), session blobs, and user settings — never private keys.
- Public-key lookup is targeted: callers must supply an exact username or full fingerprint. There is no browse/list-all endpoint, which limits passive enumeration.
- Input length caps for usernames, labels, hashes, etc. are enforced at the API boundary in `server/validators.js` (SQLite does not enforce VARCHAR length itself).
- The generated Root CA is for local development only — do not use it in production.

**Known gaps** (tracked in [ROADMAP.md](ROADMAP.md)):

- Anyone holding a session cookie is that user — there is no device binding or "log out other sessions".
- Rate-limit counters are in memory and per IP; an attacker spread over many IPs can still guess one account's password slowly.
