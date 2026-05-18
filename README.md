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

- [Node.js](https://nodejs.org/) v16 or higher
- [OpenSSL](https://www.openssl.org/) 1.1+ on your PATH (`openssl version` to verify)

## Setup & Running

### Convenience scripts (Windows)

Two `.bat` scripts in the repo root wrap the steps below:

- `setup.bat` — runs `npm install`, `npx prisma migrate deploy`, and the cert generator. Use it once after cloning.
- `start.bat` — opens two cmd windows, one running `npm start` (server) and one running `npx prisma studio` (DB inspector).

Double-click either, or run from any terminal. The manual steps below still work if you prefer them.

### 1. Install dependencies

```bash
npm install
```

`postinstall` runs `prisma generate` automatically so the Prisma Client is built against the current schema.

### 2. Initialize the database

```bash
npx prisma migrate deploy
```

This creates `dev.db` (gitignored) and applies all migrations in `prisma/migrations/`. Re-run after any `git pull` that brings new migrations.

To browse the data later: `npx prisma studio` (UI at <http://localhost:5555>). For a full reset: `npx prisma migrate reset`.

### 3. Generate the CA chain (one-time)

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

### 4. Trust the Root CA (optional but recommended)

Without this step the browser shows a certificate warning. With it, you get a proper green padlock.

**Windows (Chrome / Edge inherit this automatically):**
1. Press `Win + R`, type `certmgr.msc`, press Enter
2. Expand **Trusted Root Certification Authorities** → right-click **Certificates** → **All Tasks** → **Import**
3. Browse to `certs/rootCA.crt` → Next → Next → Finish → Yes

**Firefox** (manages its own trust store):
- `about:preferences#privacy` → **View Certificates** → **Authorities** → **Import** → select `certs/rootCA.crt` → check *Trust this CA to identify websites* → OK

Restart the browser after importing.

### 5. Start the server

```bash
npm start
```

### 6. Open the app

Navigate to **https://localhost:3443**.

After importing the Root CA you should see a closed padlock. Click it → **Connection is secure** → **Certificate is valid** to inspect the full chain.

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
│   └── gen-ca-chain.sh      # OpenSSL PKI generation script
├── server/                  # Node.js/Express backend
│   ├── server.js            # Entry point, HTTPS server (port 3443)
│   ├── auth.js              # /api/auth/*  (register, login, logout, me)
│   ├── settings.js          # /api/settings  (per-user crypto preferences)
│   ├── keys.js              # /api/keys/*   (register/list/look up/delete public keys)
│   ├── signatures.js        # /api/signatures/*  (audit log)
│   ├── userStore.js         # Prisma/SQLite user storage + shared client export
│   ├── sessionStore.js      # Custom express-session Store backed by Prisma
│   ├── middleware.js        # requireAuth
│   └── validators.js        # Centralized input/length validation
├── dev.db                   # SQLite database — gitignored (created on first run)
├── certs/                   # Generated certificates — gitignored
├── database-planning.md     # Schema + querying reference
└── package.json
```

## API at a glance

All endpoints under `/api`. Sessions are cookie-based; `requireAuth` guards everything except `auth/login`, `auth/register`, and the public `auth/me` check.

| Route | Purpose |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Account lifecycle |
| `PUT /auth/username`, `PUT /auth/password` | Change username / password from the Settings → Account card (both require current-password re-confirmation) |
| `GET /settings`, `PUT /settings` | Per-user crypto preferences |
| `POST /keys`, `GET /keys/mine`, `DELETE /keys/:id` | Manage your own public keys |
| `GET /keys/by-username/:u`, `GET /keys/by-fingerprint/:fp` | Targeted lookup for verification |
| `POST /signatures`, `GET /signatures/mine` | Append / read signing audit log |

See [database-planning.md](database-planning.md) for the data model and Prisma query examples.

## Verifying TLS from the command line

```bash
openssl s_client -connect localhost:3443 -CAfile certs/rootCA.crt
```

Look for `Verify return code: 0 (ok)` to confirm the chain validates correctly.

## Security Notes

- Private keys are generated and used entirely in the browser; they are never sent to the server.
- Passwords are hashed with bcrypt before storage.
- Sessions are persisted in SQLite via a Prisma-backed `express-session` store and survive server restarts. Cookies are HTTP-only and secure (HTTPS-only).
- User data is stored in a local SQLite database (`dev.db`). The server stores only public keys, signing-event records, user credentials (bcrypt hashes), session blobs, and user settings — never private keys.
- Public-key lookup is targeted: callers must supply an exact username or full fingerprint. There is no browse/list-all endpoint, which limits passive enumeration.
- Input length caps for usernames, labels, hashes, etc. are enforced at the API boundary in `server/validators.js` (SQLite does not enforce VARCHAR length itself).
- The generated Root CA is for local development only — do not use it in production.
