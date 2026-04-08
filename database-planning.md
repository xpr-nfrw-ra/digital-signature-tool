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

The database consists of 4 tables, all related to the `users` table:

```
users ──< sessions
users ──< signature_log
users ──< public_keys
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
| `id` | TEXT (PK) | Unique session ID |
| `user_id` | INTEGER (FK) | Reference to `users.id` |
| `session_data` | TEXT | Session data serialized as JSON |
| `expires_at` | DATETIME | Expiry timestamp |

**Relation:** `user_id` → `users.id`

**Note:** Expired sessions are not automatically deleted — cleanup logic (delete where `expires_at < now()`) is planned to be added on server startup or via a periodic job.

---

### 3. `signature_log` — Signature Log

**Purpose:** Records every signing event for audit and later verification.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER (PK) | Auto-incrementing ID |
| `user_id` | INTEGER (FK) | Who signed — reference to `users.id` |
| `document_name` | TEXT | Filename or label of the signed document |
| `document_hash` | TEXT | Hash of the signed content |
| `public_key_fingerprint` | TEXT | Links to the `public_keys` table |
| `signed_at` | DATETIME | Signing timestamp |

**Relation:** `user_id` → `users.id`

**Use case:** "Did this user sign this document at this time?" — verified by cross-referencing `public_key_fingerprint` against the `public_keys` table.

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
┌─────────┐ ┌──────────────┐ ┌──────────┐
│sessions │ │signature_log │ │public_   │
│         │ │              │ │keys      │
│id       │ │id            │ │id        │
│user_id  │ │user_id       │ │user_id   │
│session_ │ │document_name │ │finger-   │
│data     │ │document_hash │ │print     │
│expires_ │ │public_key_   │ │public_   │
│at       │ │fingerprint   │ │key_pem   │
└─────────┘ │signed_at     │ │label     │
            └──────────────┘ │created_at│
                             └──────────┘
```

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
