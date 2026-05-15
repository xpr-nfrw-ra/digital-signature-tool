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
| `username` | TEXT (unique) | Username — must be unique |
| `password_hash` | TEXT | bcrypt-hashed password |
| `created_at` | DATETIME | Registration timestamp |

**Important:** Passwords are never stored in plaintext — only as a bcrypt hash.

---

### 2. `sessions` — Sessions

**Purpose:** Stores login session data. Replaces the in-memory store of `express-session`, so sessions survive server restarts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | express-session ID |
| `user_id` | INTEGER (FK, nullable) | Reference to `users.id` — null for anonymous sessions |
| `session_data` | TEXT | Session data serialized as JSON |
| `expires_at` | DATETIME (indexed) | Expiry timestamp |

**Relation:** `user_id` → `users.id` (CASCADE delete).

**Implementation:** `server/sessionStore.js` is a custom express-session `Store` backed by Prisma. Expired rows are deleted on server startup via `cleanupExpiredSessions()` and lazily on `get()` when an expired row is read.

---

### 3. `signature_log` — Signature Log

**Purpose:** Records every signing event for audit and later verification.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER (PK) | Auto-incrementing ID |
| `user_id` | INTEGER (FK) | Who signed — reference to `users.id` |
| `document_name` | TEXT | Filename or label of the signed document (≤ 255 chars, app-enforced) |
| `document_hash` | TEXT | Hash of the signed content (hex, ≤ 128 chars) |
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
| `fingerprint` | TEXT (unique) | Key fingerprint — links to `signature_log` |
| `public_key_pem` | TEXT | Public key in PEM format |
| `label` | TEXT | User-defined name (e.g. "Work Key") |
| `created_at` | DATETIME | Creation timestamp |

**Relation:** `user_id` → `users.id`

**Important:** Public keys can be stored server-side — they are not secret. **Private keys** are never sent to or stored by the server.

---

### 5. `user_settings` — Per-user preferences

**Purpose:** Stores each user's crypto/UI preferences (hash algorithm, signature algorithm, key size, default public key). 1-to-1 with `users`. Replaces the in-memory `appSettings` object on the client.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | INTEGER (PK, FK) | Owner — also primary key (1-to-1 with `users.id`) |
| `hash_algorithm` | TEXT | `sha256` \| `sha384` \| `sha512` (SHA-3 deferred — requires non-forge crypto lib) |
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
└─────────┘ └──────────────┘ │label     │ └──────────────┘
                             │created_at│
                             └──────────┘

signature_log.public_key_id → public_keys.id (FK)
user_settings.default_public_key_id → public_keys.id (FK, nullable)
```

A user can store **many** public keys. All of them are returned by `GET /api/keys/by-username/:u`. `user_settings.default_public_key_id` is just a personal bookmark — it does not hide or restrict any other keys.

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

For the planned backend phase of the project:

- `signature_log` — will power "who signed what, and when" queries
- `public_keys` — enables live key exchange in multi-user verification workflows

Currently, only the `users` table is fully integrated into the application logic. The remaining tables are schema-ready for future functionality.
