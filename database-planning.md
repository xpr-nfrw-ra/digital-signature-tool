# Database Description

**Project:** Digital Signature Tool  
**Database:** SQLite (via Prisma ORM)  
**File:** `digital-signature-tool/dev.db`  
**Schema:** `digital-signature-tool/prisma/schema.prisma`

---

## Setup & Usage

### First-time setup

```bash
cd digital-signature-tool
npm install          # also runs `prisma generate` via postinstall hook
npx prisma migrate deploy   # creates dev.db and applies all migrations
```

`dev.db` is created at `digital-signature-tool/dev.db`. It is gitignored.

### Inspecting the database

```bash
npx prisma studio    # opens a browser UI at http://localhost:5555
```

### Inspecting column constraints

**Short answer — what places and enforces these restrictions?** Length and shape rules are enforced at the API boundary in [server/validators.js](server/validators.js). Every write route (`auth.js`, `keys.js`, `signatures.js`) calls `validate()` before touching the database, so invalid input is rejected with a 400 before Prisma ever sees it. SQLite itself only enforces types, `NOT NULL`, `UNIQUE`, and foreign keys (declared in `prisma/schema.prisma`); it ignores `VARCHAR(n)` and has no regex support, which is why the app layer owns length and character-class rules.

Constraints live in three places — check all three when verifying a column's rules:

1. **Prisma schema** (`prisma/schema.prisma`) — the canonical source. Types, nullability, `@unique`, `@default`, FK relations and `onDelete` are declared here.
2. **SQLite — actual DB-enforced constraints:**

   ```bash
   sqlite3 dev.db ".schema <table>"          # CREATE TABLE statement, including FKs and indexes
   sqlite3 dev.db "PRAGMA table_info(<table>);"          # columns, types, NOT NULL, defaults, PK
   sqlite3 dev.db "PRAGMA foreign_key_list(<table>);"    # FKs with ON DELETE / ON UPDATE
   sqlite3 dev.db "PRAGMA index_list(<table>);"          # indexes (including UNIQUE)
   ```

3. **API-layer caps and shape rules** — SQLite ignores `VARCHAR(n)` length limits and has no character-class constraints, so both length caps and character/format rules (regex patterns, forbidden characters, exact lengths for crypto-derived fields) are enforced in [server/validators.js](server/validators.js). Anything not declared there is not enforced. The `LIMITS` object is the source of truth — see it for the exact rule per field.

### Making schema changes

1. Edit `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name <description>` — generates a migration file and applies it
3. The migration file is saved under `prisma/migrations/` and should be committed

### Resetting the database (wipes all data)

```bash
npx prisma migrate reset
```

---

## Overall Structure

The database consists of 5 tables, all related to the `users` table:

```text
users ──< sessions
users ──< signature_log
users ──< public_keys
users ──1 user_settings
```

The `──<` symbol denotes a **one-to-many** relationship: one user can have multiple records in the associated tables.

---

## Tables

### 1. `users` — Users

**Purpose:** Stores registered user data. Replaces the old `data/users.json` file.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER (PK) | Auto-incrementing unique ID |
| `username` | TEXT (unique) | Username — must be unique. App-enforced: 3–32 chars, `^[a-zA-Z0-9_.-]+$` (letters, digits, `.`, `_`, `-`) |
| `password_hash` | TEXT | bcrypt-hashed password |
| `created_at` | DATETIME | Registration timestamp |

**Important:** Passwords are never stored in plaintext — only as a bcrypt hash.

---

### 2. `sessions` — Sessions

**Purpose:** Stores login session data. Replaces the in-memory store of `express-session`, so sessions survive server restarts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | express-session ID — matches the `connect.sid` cookie |
| `user_id` | INTEGER (FK, nullable) | Reference to `users.id` — null for anonymous sessions (in practice never persisted, see below) |
| `session_data` | TEXT | Session data serialized as JSON: `{ cookie, user: { id, username } }` |
| `expires_at` | DATETIME (indexed) | Absolute expiry — `created_at + cookie.maxAge`, bumped on every authenticated request via `touch()` (sliding window) |
| `created_at` | DATETIME | When the row was first inserted; never updated |

**Relation:** `user_id` → `users.id` (CASCADE delete — deleting a user wipes their sessions).

**Lifecycle:**
- **Start:** a row appears when `req.session` first receives a non-default property. In practice that's on register or login (`req.session.user = …`). Because `saveUninitialized: false` is set in [server/server.js](server/server.js), anonymous visitors do not produce a row.
- **Session ID rotation:** login and register call `req.session.regenerate()` before writing `req.session.user`. This prevents session-fixation attacks (an attacker cannot pre-seed a victim's cookie and inherit the authenticated session).
- **End — explicit:** `POST /api/auth/logout` calls `req.session.destroy()`, which deletes the row and clears the cookie.
- **End — expiry:** sliding 2-hour idle window. `expires_at` is refreshed on every authenticated request via `touch()`. After 2h of inactivity, the row is purged either by the lazy check in `get()` or by the startup sweep `cleanupExpiredSessions()`. There is no absolute timeout — an actively-used session can live indefinitely.
- **End — cascade:** deleting a user via `users` removes their sessions.
- **Does NOT end on:** closing the browser tab (cookie is persistent via `maxAge`), server restart (Prisma store persists rows).

**What is intentionally NOT stored:** IP address, user-agent, `last_seen_at`. No feature consumes them yet, and they introduce PII / per-request write churn. Revisit if a "manage active sessions" UI is added.

**Implementation:** `server/sessionStore.js` is a custom express-session `Store` backed by Prisma. Expired rows are deleted on server startup via `cleanupExpiredSessions()` and lazily on `get()` when an expired row is read.

---

### 3. `signature_log` — Signature Log

**Purpose:** Records every signing event for audit and later verification.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER (PK) | Auto-incrementing ID |
| `user_id` | INTEGER (FK) | Who signed — reference to `users.id` |
| `document_name` | TEXT | Filename or label of the signed document. App-enforced: 1–255 chars, no control chars, no `/` or `\` |
| `document_hash` | TEXT | Hash of the signed content. App-enforced: hex, exactly 64 / 96 / 128 chars (SHA-256 / 384 / 512) |
| `public_key_id` | INTEGER (FK) | Which key signed — reference to `public_keys.id` |
| `signed_at` | DATETIME | Signing timestamp |

**Relations:** `user_id` → `users.id`, `public_key_id` → `public_keys.id`

**Use case:** "Did this user sign this document at this time?" — joined directly against `public_keys` to retrieve fingerprint + PEM.

**Note on size limits:** SQLite does not enforce column length. Caps documented above are enforced at the API layer via `server/validators.js`.

**Crypto note:** The signing operation is performed entirely in the browser (via forge.js). The database stores *evidence* of a signing event — it does not perform cryptographic operations.

---

### 4. `public_keys` — Public Keys

**Purpose:** Allows users to store their public keys server-side so other users can retrieve them for verification without manual key exchange.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER (PK) | Auto-incrementing ID |
| `user_id` | INTEGER (FK) | Reference to `users.id` |
| `fingerprint` | TEXT (unique) | Key fingerprint — links to `signature_log`. App-enforced: exactly 64 hex chars (SHA-256 of DER SPKI) |
| `public_key_pem` | TEXT | Public key in PEM format. App-enforced: 100–8192 chars, must match `-----BEGIN PUBLIC KEY-----…-----END PUBLIC KEY-----` |
| `label` | TEXT | User-defined name (e.g. "Work Key"). App-enforced: 1–64 chars, no control chars |
| `created_at` | DATETIME | Creation timestamp |

**Relation:** `user_id` → `users.id`

**Important:** Public keys can be stored server-side — they are not secret. **Private keys** are never sent to or stored by the server.

---

### 5. `user_settings` — Per-user preferences

**Purpose:** Stores each user's crypto/UI preferences (hash algorithm, signature algorithm, key size, default public key). 1-to-1 with `users`. Replaces the in-memory `appSettings` object on the client.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | INTEGER (PK, FK) | Owner — also primary key (1-to-1 with `users.id`) |
| `hash_algorithm` | TEXT | `sha256` \| `sha384` \| `sha512` (SHA-3 intentionally not supported — forge.js doesn't ship it and no compelling use case here) |
| `signature_algorithm` | TEXT | `rsa` \| `ecdsa` |
| `key_size` | INTEGER | `2048` \| `3072` \| `4096` |
| `default_public_key_id` | INTEGER (FK, nullable) | Bookmark of the user's preferred signing key. Does **not** restrict which keys are stored or returned by lookups — a user can have many keys in `public_keys` and all of them are searchable. |
| `updated_at` | DATETIME | Last update timestamp |

**Relations:** `user_id` → `users.id` (CASCADE delete), `default_public_key_id` → `public_keys.id` (SET NULL on delete).

**API:** `GET /api/settings` and `PUT /api/settings` (auth required). Defaults inserted on registration.

---

## Relationship Diagram

```
┌─────────────────────────────────────┐
│               users                 │
│─────────────────────────────────────│
│ id (PK)                             │
│ username                            │
│ password_hash                       │
│ created_at                          │
└──────────┬──────────────────────────┘
           │ (1)
    ┌──────┴───────────────────────┐
    │ (many)                       │
    │                              │
    ▼              ▼               ▼
┌─────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────┐
│sessions │ │signature_log │ │public_   │ │user_settings │
│         │ │              │ │keys      │ │              │
│id       │ │id            │ │id        │ │user_id (PK)  │
│user_id? │ │user_id       │ │user_id   │ │hash_algo     │
│session_ │ │document_name │ │finger-   │ │sig_algo      │
│data     │ │document_hash │ │print     │ │key_size      │
│expires_ │ │public_key_id ├─┤public_   │ │default_pk_id?│
│at       │ │signed_at     │ │key_pem   │ │updated_at    │
│created_ │ └──────────────┘ │label     │ └──────────────┘
│at       │                  │created_at│
└─────────┘                  └──────────┘

signature_log.public_key_id → public_keys.id (FK)
user_settings.default_public_key_id → public_keys.id (FK, nullable)
```

### On-delete behavior of every FK

| FK | On parent delete | Why |
|---|---|---|
| `user_settings.user_id` → `users.id` | **CASCADE** | Settings are useless without the user. |
| `user_settings.default_public_key_id` → `public_keys.id` | **SET NULL** | Just a bookmark; clearing it is the right thing. |
| `sessions.user_id` → `users.id` | **CASCADE** | Orphaned sessions are a security smell. |
| `signature_log.user_id` → `users.id` | **RESTRICT** | Audit trail must outlive an account deletion. To delete a user, log entries must be handled explicitly first. |
| `signature_log.public_key_id` → `public_keys.id` | **RESTRICT** | A key that signed something cannot be silently removed. |
| `public_keys.user_id` → `users.id` | **RESTRICT** | A user's keys may be referenced by `signature_log`; deleting the user would orphan those references unless the keys are dealt with first. |

A user can store **many** public keys. All of them are returned by `GET /api/keys/by-username/:u`. `user_settings.default_public_key_id` is just a personal bookmark — it does not hide or restrict any other keys.

---

## Authentication & authorization

For anyone maintaining the DB or auditing access control, here is the full picture.

### The model in one paragraph

Every user is equal — there is **no role column, no admin role, and no privilege hierarchy**. Authentication establishes *who* the caller is; authorization is then checked per-route by comparing the row's `user_id` against `req.session.user.id`. A user can only read/write their own rows. The two public-lookup endpoints (`/api/keys/by-username`, `/api/keys/by-fingerprint`) intentionally expose other users' public keys — public keys are not secret, and verification needs them.

### Authentication

1. **Credentials** — username + password against `users`. Passwords are stored as bcrypt hashes (10 salt rounds) in `users.password_hash`. Plaintext is never persisted and never logged.
2. **Login flow** ([server/auth.js](server/auth.js)):
   - `findUserByUsername` → `bcrypt.compare` → on match, `req.session.regenerate()` issues a fresh session ID (prevents session fixation) → `req.session.user = { id, username }` is written.
   - A row appears in `sessions` keyed by the new session ID; the cookie `connect.sid` is set on the response.
3. **Subsequent requests** — express-session reads the cookie, the Prisma store loads the row, `req.session.user` is rehydrated. Every authenticated request bumps `expires_at` (sliding 2h idle window).
4. **Logout** — `req.session.destroy()` deletes the `sessions` row and clears the cookie.

### Authorization

Authorization happens in two layers:

**Layer 1 — gate:** [server/middleware.js](server/middleware.js)'s `requireAuth` rejects unauthenticated requests with 401. It's applied to *every* sensitive route: all of `/api/settings`, `/api/keys/*`, `/api/signatures/*`. The only auth-free endpoints are `/api/auth/register`, `/api/auth/login`, and `/api/auth/me` (which 401s on its own if no session exists).

**Layer 2 — ownership check:** inside each handler, when a route operates on a row, the handler verifies `row.userId === req.session.user.id` before reading, writing, or deleting. Examples:

| Route | Ownership check | File |
|---|---|---|
| `DELETE /api/keys/:id` | key.userId === session.user.id | [server/keys.js](server/keys.js) |
| `POST /api/keys` (duplicate fingerprint) | existing.userId === session.user.id | [server/keys.js](server/keys.js) |
| `POST /api/signatures` | publicKey.userId === session.user.id | [server/signatures.js](server/signatures.js) |
| `PUT /api/settings` (default key) | key.userId === session.user.id | [server/settings.js](server/settings.js) |
| `GET /api/keys/mine`, `GET /api/signatures/mine`, `GET/PUT /api/settings` | always queries by `req.session.user.id` | (the where-clause *is* the check) |

**Public reads:** `/api/keys/by-username/:u` and `/api/keys/by-fingerprint/:fp` return another user's public keys by design — used during verification. They require a session (`requireAuth`) but no ownership check, since public keys are not secret. There is **no listing endpoint** — you have to know the exact username or fingerprint.

### Decision: no roles, no admin

A `users.role` column was considered and rejected for now:

- The app has no admin-only actions. Every operation is "act on my own data."
- Database maintenance (deleting users, running ad-hoc reports) is done out-of-band via `sqlite3` / Prisma Studio by whoever has filesystem access to `dev.db` — that's the de-facto admin boundary.
- Adding a role column without an admin feature to consume it would be dead schema.

If admin features are ever added (e.g., "delete a user and their orphaned data", "view system-wide signature stats"), the natural extension is:

1. Add `role` enum column to `users` (default `'user'`).
2. Add `requireAdmin` middleware in `server/middleware.js`.
3. Apply it on top of `requireAuth` for admin routes only.

Until then, the model stays flat.

### Threats this model does not address

- **Compromised session cookie** — anyone with the cookie value is the user. Mitigations in place: `httpOnly` (no JS access), `secure` (HTTPS only), `regenerate()` on login (no fixation). Mitigations *not* in place: device binding, IP pinning, or a "log out other sessions" UI.
- **Account deletion** — not implemented yet. Username and password change are in place via `PUT /api/auth/username` / `PUT /api/auth/password` (both require current-password re-confirmation; password change rotates the session ID).
- **Rate limiting on `/api/auth/login`** — none. Brute-force on usernames is currently possible.

---

## Production deployment & admin access

> **Status:** the app currently runs only on the developer's laptop. This section is a forward-looking plan for the day it moves to a remote server. None of it applies in local dev.

The model: **app users authenticate to the app; admins authenticate to the operating system.** Those are two separate fortresses, and a breach in one does not give access to the other.

### Why not "log in to Prisma Studio with admin credentials"?

Considered and rejected. Three reasons specific to this stack:

1. **Prisma Studio has no auth API** — it is a Prisma-team dev tool with no login hook, no plugin point, no `--auth` flag. Adding auth means wrapping it in a reverse proxy (nginx + basic auth / oauth2-proxy), which doubles the moving parts and gives Studio itself zero notion of *who* is logged in (no per-admin audit).
2. **SQLite has no user/role system** — Postgres can hand out per-admin DB logins with bounded permissions; SQLite cannot. Any process that can open `dev.db` has full read/write on every row. So even a perfectly-wrapped Studio gives every authenticated admin the same omnipotent access.
3. **Studio is documented as a dev tool** — its internals change between Prisma releases; an upgrade can quietly break any wrapper built around it.

### The deployment model: SSH + filesystem permissions

For SQLite, filesystem permissions *are* the DB-level role system. The OS already has the user/group concept SQLite lacks. Use it.

**App-side setup:**

1. Create a dedicated service user (e.g. `signtool`) to run `npm start`. It is the only user that needs to read/write `dev.db`.
2. Place `dev.db` outside the repo, owned by `signtool`, mode `0600`:
   ```bash
   chown signtool:signtool /var/lib/signtool/dev.db
   chmod 600 /var/lib/signtool/dev.db
   ```
3. Set the app to load `SESSION_SECRET` from an environment variable rather than the hardcoded dev string in [server.js](server/server.js). Store it via the OS init system (systemd `EnvironmentFile=`) or a secrets manager — never in the repo.
4. Disable password SSH; require SSH keys (ideally + MFA via Google Authenticator / hardware key).

**Admin-side access:**

1. Each admin gets their own Linux account (`alice_admin`, `bob_admin`) — so `/var/log/auth.log` and `sudo` logs attribute every action.
2. Admins are members of a `db_admins` group; that group has `sudoers` entries for the specific commands needed:
   ```
   %db_admins ALL=(signtool) NOPASSWD: /usr/bin/sqlite3 /var/lib/signtool/dev.db
   %db_admins ALL=(signtool) NOPASSWD: /usr/bin/npx prisma studio
   ```
3. To run Studio remotely:
   - On admin's laptop: `ssh -L 5555:localhost:5555 server`
   - On the server (inside the SSH session): `sudo -u signtool npx prisma studio`
   - On admin's laptop: open `http://localhost:5555` in a browser. Studio sees a connection from `127.0.0.1` on the server; the traffic is tunnelled through SSH.
4. Studio is **never bound to a public interface** (no `--hostname 0.0.0.0`). Nothing outside the SSH tunnel can reach it.

### Where each piece of access control lives

| Concern | Mechanism |
|---|---|
| Who can run the app | Linux service user (`signtool`) + systemd unit |
| Who can SSH in | SSH keys + (optional) MFA |
| Who can read `dev.db` | Unix file permissions (`0600`, owned by `signtool`) |
| Who can run Studio / sqlite3 against it | `sudoers` rules for `db_admins` group |
| Who is acting | Linux account name in audit logs + sudo logs |
| Who can use the app over HTTPS | App-layer auth (bcrypt + session cookie) — unchanged |

### When to revisit this

If the project ever moves off SQLite to Postgres, the story changes: Postgres has DB-level users, so the SSH-tunnel pattern stays, but inside the tunnel each admin connects with their own Postgres login for finer-grained audit. The OS layer continues to gate *who can reach* the DB; the DB layer then gates *what they can do once connected*.

Separately, if the app grows admin-only features (list users, view system-wide signature activity, etc.), that calls for an app-level `users.role` column and a `requireAdmin` middleware — a different concern from this section. App-level admin views handle routine ops; SSH+Studio handles raw-data investigation.

---

## Querying the database

There are three ways data leaves the database, depending on who is asking.

### 1. From server code — Prisma Client (the production path)

All app code queries the DB through Prisma's typed JS client (`prisma.user`, `prisma.publicKey`, …). The client is imported via [server/userStore.js](server/userStore.js); each router uses it directly. Examples drawn from the actual routes:

```js
// Find a user (auth.js)
await prisma.user.findUnique({ where: { username } });

// List ALL public keys for a username — used by the verification lookup (keys.js)
const user = await prisma.user.findUnique({ where: { username } });
await prisma.publicKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
});

// Find a single key by its globally-unique fingerprint (keys.js)
await prisma.publicKey.findUnique({ where: { fingerprint } });

// Insert a signing-event row, joining the key on its fingerprint (signatures.js)
const key = await prisma.publicKey.findUnique({ where: { fingerprint } });
await prisma.signatureLog.create({
    data: { userId, documentName, documentHash, publicKeyId: key.id },
});

// User's signing history with the key it was made with (signatures.js)
await prisma.signatureLog.findMany({
    where: { userId },
    orderBy: { signedAt: 'desc' },
    include: { publicKey: { select: { fingerprint: true, label: true } } },
});
```

All such calls are async and return plain JS objects shaped after the schema. Prisma handles parameter escaping — never build SQL by hand.

### 2. From the browser — HTTP API

The browser cannot reach the database directly. It calls HTTP endpoints, which run the Prisma queries above:

| Endpoint | What it does |
|---|---|
| `GET  /api/auth/me` | Current session info |
| `GET  /api/settings`     `PUT /api/settings` | Read / update `user_settings` |
| `POST /api/keys` | Register a public key (server computes fingerprint, inserts row) |
| `GET  /api/keys/mine` | All public keys for the logged-in user |
| `GET  /api/keys/by-username/:u` | All public keys belonging to that exact username |
| `GET  /api/keys/by-fingerprint/:fp` | Single key by fingerprint |
| `DELETE /api/keys/:id` | Delete one of the caller's keys |
| `POST /api/signatures` | Log a signing event |
| `GET  /api/signatures/mine` | The caller's signing history |

All write endpoints and lookups require an authenticated session (`requireAuth`).

### 3. From outside the app — Prisma Studio or raw SQL

For inspection, debugging, or one-off reports:

```bash
cd digital-signature-tool
npx prisma studio        # web UI at http://localhost:5555 — browse + edit any row
```

For ad-hoc SQL:

```bash
sqlite3 dev.db                                 # opens the SQLite shell
sqlite> .tables                                # list tables
sqlite> .schema public_keys                    # show CREATE TABLE
sqlite> SELECT username, COUNT(pk.id) AS keys
   ...> FROM users u LEFT JOIN public_keys pk ON pk.user_id = u.id
   ...> GROUP BY u.id;
```

Raw SQL bypasses Prisma and the API — useful for inspection but should not be wired into app code. If application logic needs a query Prisma can't express cleanly, use `prisma.$queryRaw` (still parameterized) rather than reaching for `sqlite3`.

---

## Core Security Principle

> **Private keys must never be stored server-side.**

All cryptographic operations (signing, verification, key generation) are performed **in the browser** via forge.js. The server stores:

- Public keys (`public_keys`)
- Signing *evidence* (`signature_log`)
- User credentials (`users`)
- Session data (`sessions`)

---

## Future Phase

All five tables are now fully integrated into the application:

- `users`, `sessions` — registration, login, and the Prisma-backed session store.
- `signature_log` — powers "who signed what, and when" via `POST /api/signatures` and `GET /api/signatures/mine`.
- `public_keys` — server-side key storage and lookup for verification (`POST /api/keys`, `GET /api/keys/by-username/:u`, `GET /api/keys/by-fingerprint/:fp`).
- `user_settings` — per-user crypto/UI preferences and default-key bookmark.

What remains genuinely future (see the sections above for detail):

- **Account deletion** — not implemented; only username/password change exist.
- **Rate limiting on `/api/auth/login`** — none yet; brute-force is currently possible.
- **Admin roles / system-wide views** — deliberately deferred (see "Decision: no roles, no admin"). Would add a `users.role` column plus `requireAdmin` middleware.
- **"Manage active sessions" UI** — would require storing IP / user-agent / `last_seen_at`, intentionally not stored today.
