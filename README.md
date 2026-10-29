# Digital Signature Tool — HTTPS with OpenSSL CA Chain

A browser-based tool for creating and verifying digital signatures. All cryptographic operations run entirely in the browser — private keys never leave your machine.

This branch (`main`) runs over HTTPS using a proper 3-tier PKI: Root CA → Intermediate CA → Server certificate, all generated locally with OpenSSL. Importing the Root CA into your OS trust store gives a genuine green padlock with no browser warnings.

## Features

- **File Signing** — sign any file with an RSA private key (client-side; logged to your audit history when signed in). The `.sig` file is a self-describing JSON envelope `{ v, alg, hash, sig }`, so verifiers don't need to match the signer's algorithm settings manually.
- **Signature Verification** — verify a file against a public key, either uploaded or looked up server-side. The verify page has its own algorithm picker that auto-fills (and locks) from the `.sig` envelope; for legacy raw-base64 signatures, the user can set the algorithm and hash for that single verification without touching their saved settings.
- **Key Generation** — generate RSA key pairs (2048 / 3072 / 4096 bits); the public half is auto-registered for logged-in users
- **Public Key Directory** — a user can register multiple public keys; verifiers look them up by exact username (returns all of that user's keys) or by fingerprint (returns the single matching key).
- **Preferred Public Key** — Settings → "My Public Keys" lists all of a user's registered keys with a radio-button picker for the preferred one. Stored in `user_settings.default_public_key_id`; it is a personal bookmark only — it does not hide or restrict which of your keys others can find.
- **User Accounts & Settings** — session-based auth (sessions persisted across restarts); per-user crypto preferences saved server-side
- **Guest Mode** — use signing/verification without an account

## Requirements

- [Node.js](https://nodejs.org/) 20.19+, 22.12+, or 24+ (required by Prisma 7)
- [OpenSSL](https://www.openssl.org/) 1.1+ and `bash` on your PATH (`openssl version` to verify; Git for Windows provides both)

## Setup & Running

### Convenience scripts (Windows)

Two `.bat` scripts in the repo root wrap the steps below:

- `setup.bat` — runs `npm install`, creates `.env` with a random `SESSION_SECRET` (if missing), runs `npx prisma migrate deploy`, and generates the CA chain. Use it once after cloning; it's safe to re-run.
- `start.bat` — opens two cmd windows, one running `npm start` (server) and one running `npx prisma studio` (DB inspector).

Double-click either, or run from any terminal. The manual steps below still work if you prefer them.

### 1. Install dependencies

```bash
npm install
```

`postinstall` runs `prisma generate` automatically so the Prisma Client is built against the current schema.

### 2. Create `.env`

Copy `.env.example` to `.env` and set `SESSION_SECRET` to a random string of at least 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`DATABASE_URL` (default `file:./dev.db`, relative to the project root) is read by both the Prisma CLI and the server. The server refuses to start without a valid `SESSION_SECRET`. `.env` is gitignored.

### 3. Initialize the database

```bash
npx prisma migrate deploy
```

This creates `dev.db` (gitignored) and applies all migrations in `prisma/migrations/`. Re-run after any `git pull` that brings new migrations.

To browse the data later: `npx prisma studio` (UI at <http://localhost:5555>). For a full reset: `npx prisma migrate reset`.

### 4. Generate the CA chain (one-time)

```bash
npm run generate-ca-chain
```

This runs `scripts/gen-ca-chain.sh` and creates the following in `certs/`:

| File | Description |
|------|-------------|
| `rootCA.key` / `rootCA.crt` | Root CA — self-signed, 10-year validity |
| `intermediate.key` / `intermediate.crt` | Intermediate CA — signed by Root, 5 years |
| `server.key` / `server.crt` | Server cert — signed by Intermediate, 1 year |
| `chain.crt` | Intermediate + Root bundle sent during TLS handshake |

### 5. Trust the Root CA (optional but recommended)

Without this step the browser shows a certificate warning. With it, you get a proper green padlock.

**Windows (Chrome / Edge inherit this automatically):**
1. Press `Win + R`, type `certmgr.msc`, press Enter
2. Expand **Trusted Root Certification Authorities** → right-click **Certificates** → **All Tasks** → **Import**
3. Browse to `certs/rootCA.crt` → Next → Next → Finish → Yes

**Firefox** (manages its own trust store):
- `about:preferences#privacy` → **View Certificates** → **Authorities** → **Import** → select `certs/rootCA.crt` → check *Trust this CA to identify websites* → OK

Restart the browser after importing.

### 6. Start the server

```bash
npm start
```

### 7. Open the app

Navigate to **https://localhost:3443**.

After importing the Root CA you should see a closed padlock. Click it → **Connection is secure** → **Certificate is valid** to inspect the full chain.

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
| `user_settings` | `hash_algorithm`, `signature_algorithm`, `key_size`, `default_public_key_id` | 1-to-1 with `users`; defaults inserted on registration. The default key is only a bookmark — it doesn't restrict lookups. |

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

**Field rules.** SQLite enforces only types, `NOT NULL`, `UNIQUE` and foreign keys — it ignores `VARCHAR(n)` and has no regex. Length and format rules (username 3–32 chars of `[a-zA-Z0-9_.-]`, document hash exactly 64/96/128 hex chars, fingerprint 64 hex, PEM shape, label 1–64 chars, …) live in the `LIMITS` object in [server/validators.js](server/validators.js), which every write route calls before touching the database.

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
- Choosing ECDSA in settings currently produces RSA keys.
