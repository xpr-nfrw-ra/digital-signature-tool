# Roadmap

What's left, what still needs deciding, and why things are the way they are. [README.md](README.md) describes the system as it is; this file describes where it's going. Tick items off and move settled questions into the decision log as work lands.

## Status

### Done
- [x] Backend structure and persistence: Express route modules, Prisma + SQLite, 5 tables, versioned migrations, explicit on-delete rules, central validation
- [x] Sessions in the database, 2h sliding expiry, session-ID rotation on login and password change; a password change logs out all other sessions
- [x] Username and password change with current-password re-confirmation
- [x] HTTPS with a local Root CA → Intermediate CA → server certificate chain
- [x] Public key directory (lookup by exact username or fingerprint) and signing audit log
- [x] Fresh-clone setup works (`npm run setup` creates `.env`, migrates, generates certs)
- [x] `SESSION_SECRET` and `DATABASE_URL` from `.env`
- [x] Rate limiting on login, register and password re-confirmation
- [x] Automated tests (`npm test`) across auth, sessions, rate limits, access control, keys, settings, signature log, validators and on-delete rules
- [x] Signing history pagination (`GET /signatures/mine?limit=&cursor=`)
- [x] Audit log lookup by document hash (`GET /signatures/by-hash/:hash`), with indexes on `signature_log.document_hash` and `user_id`
- [x] Account deletion (`DELETE /auth/account`): soft delete with current-password re-confirmation, plus a Delete Account section in Settings
- [x] Real ECDSA (P-256 / P-384 / P-521) via the Web Crypto API, alongside RSA
- [x] Minimum length for new passwords raised from 6 to 8; existing shorter passwords still log in
- [x] Frontend: Signing History card (paged) and "Who signed this file?" on the verify page
- [x] Docker image as an alternative way to run the app (`Dockerfile`, `docker-entrypoint.sh`); still uses the local CA, so it is not the production deployment below

### Next, in order
1. [ ] **Production deployment** — once there is a target server. See the plan below.

### Smaller items
- [ ] Optional: a "log out other sessions" view (would need IP / user-agent / last-seen stored per session, which is deliberately not done today).

## Open decisions

No open decisions right now.

## Decision log

- **No roles, no admin.** Every operation is "act on my own data", so a `role` column would be dead schema. If admin features appear: add `users.role`, a `requireAdmin` middleware, and apply it on top of `requireAuth`.
- **Audit trail outlives accounts and keys.** `signature_log` foreign keys are RESTRICT, so a signing record can never be removed as a side effect of deleting a user or key.
- **Account deletion is a soft delete (D2, 2026-10-29).** The user row is kept with `deleted_at` set, renamed to `deleted:<id>` (an illegal username, so the real name is freed and can't be collided with), and its password hash replaced with an unmatchable value; settings and all sessions are deleted. Keys and signing history stay, so signatures made before deletion remain verifiable; lookups show the owner as `accountDeleted` with no name. Hard delete was rejected because anyone who had ever signed something could then never delete their account.
- **Hash lookup shows any user's signatures (D1, 2026-10-29).** `GET /signatures/by-hash/:hash` returns every signer of a document to any logged-in user, so the audit log can back up a signature ("did Alice sign this exact file?"), not just serve as private history. It returns only username, key fingerprint and time — not the signer's document name, which may reveal more than the hash. You must already hold the file (or its hash) to ask, matching the targeted-lookup approach for public keys.
- **Cursor pagination on id.** Signing history pages by `id < cursor`, newest first; ids follow insertion order, so new entries never shift later pages (offset paging would).
- **ECDSA implemented, not removed (D3, 2026-10-29).** Uses the browser's Web Crypto API (forge.js had no ECDSA; RSA later moved to Web Crypto too). The existing 2048/3072/4096 key-size setting maps to P-256/P-384/P-521, so no schema change. Keys are PKCS#8/SPKI PEM and signatures DER, so they interoperate with OpenSSL and the server's fingerprinting.
- **The key decides the algorithm.** Signing and verification detect RSA vs ECDSA from the key, not from settings or the `.sig` label. A key can't be used with the wrong algorithm, and signatures made before real ECDSA existed (labelled "ecdsa" but RSA inside) still verify.
- **npm scripts are the way to run the project.** `npm run setup`, `npm run dev`, `npm start`, `npm run db`, `npm test` work on any OS. The Windows `setup.bat` / `start.bat` double-click wrappers were removed (2026-11-16) so there is one way to run it. `start` and `dev` run `scripts/preflight.js` first, which explains what is missing if setup was skipped and applies new migrations, so a `git pull` never leaves the database behind the code.
- **The local CAs are name-constrained (2026-11-20).** Root and Intermediate carry a critical `nameConstraints` extension permitting only `localhost`, `signtool.local` and `127.0.0.1`, so a leaked `rootCA.key` or `intermediate.key` can't be used to impersonate other websites on a machine that trusts the Root CA. Constraining only the Intermediate was not enough, because the root key could sign a new unconstrained intermediate. A new SAN in `scripts/gen-ca-chain.sh` must be added to `NAME_CONSTRAINTS` too, or the server certificate fails verification.
- **`effect` is overridden to 3.22.5 (2026-11-20).** `@prisma/config` 7.10.1 (Prisma CLI only, not the runtime) pins `effect@3.20.0`, which has a ReDoS advisory (GHSA-7589-6fvf-x4pw). `npm audit fix --force` would downgrade Prisma to 6, so `package.json` `overrides` forces the patched 3.x instead. Remove the override once Prisma ships a fixed `effect` itself. Majors held back on purpose: Prisma 8 (only an RC), better-sqlite3 13 (the Prisma adapter requires ^12), Express 5 (a migration of its own).
- **Docker is a supported alternative, npm stays primary (2026-11-20).** Running the app as a container became a requirement, so the "one way to run it" rule above now has this one exception. The image contains no secrets: `docker-entrypoint.sh` creates `SESSION_SECRET`, the CA chain and the database in the `/app/data` volume on first start, so a shared image never carries anyone's keys or data. The entrypoint repeats the secret and migration steps of `scripts/setup.js` / `scripts/preflight.js` (preflight expects a `.env` file, which the container doesn't have); change both together.
- **No list-all public keys endpoint.** Lookup needs an exact username or fingerprint, which limits passive enumeration.
- **No per-username login lockout.** It would let anyone lock a victim out. Rate limits are per IP (login, register) and per user (re-auth routes), and only wrong-password (401) responses count.
- **Rate-limit counters in memory.** Fine for a single instance; they reset on restart. Revisit if the app runs on multiple processes.
- **Sessions don't store IP or user-agent.** Nothing uses them yet, and they add PII and a write on every request.
- **Validation in the app, not the database.** SQLite ignores `VARCHAR(n)` and has no regex, so `server/validators.js` is the single place for length and format rules.
- **No SHA-3.** The browser's Web Crypto API doesn't offer it, and there's no compelling use case.
- **All cryptography on Web Crypto; forge.js removed (2026-11-16).** The bundled forge 1.3.1 had 28 published advisories, several of them RSA PKCS#1 v1.5 signature forgeries in exactly the verification code this app used (one still unfixed upstream), and its string-based hashing failed on large files ("Maximum call stack size exceeded" at 50 MB). Web Crypto is native, audited and fast. Generated RSA private keys are now PKCS#8 instead of PKCS#1; both formats (and SEC1 EC keys) are still accepted for signing, and older signatures still verify.
- **Only usable, strong public keys are registered (2026-11-16).** RSA ≥ 2048 bits with e = 65537, or ECDSA on P-256/P-384/P-521. Anything else could never verify in the browser or would be weak.
- **Usernames are unique regardless of case (2026-11-16).** Checked in the app (`COLLATE NOCASE` query) rather than a database index, so the schema stays expressible in Prisma. Login is still by the exact stored spelling.
- **New passwords are capped at 72 bytes (2026-11-16).** bcrypt silently ignores anything longer, so a longer limit would only pretend to add strength. Existing longer passwords still log in.
- **Admin access through the OS, not through a web login for Prisma Studio.** Studio has no auth hooks and SQLite has no database users, so filesystem permissions are the real access boundary (see below).

## Production deployment plan

Not started; applies once the app moves off the developer laptop.

- Run the app as a dedicated service user (e.g. `signtool`) under systemd. Keep `dev.db` outside the repo, owned by that user, mode `0600`.
- Supply `SESSION_SECRET` and `DATABASE_URL` through systemd `EnvironmentFile=` or a secrets manager — not a `.env` in the repo directory.
- Replace the local CA with a real certificate.
- SSH with keys only (ideally plus MFA). Each admin has their own Linux account; a `db_admins` group gets `sudo -u signtool` rights for `sqlite3` and `prisma studio` only, so every action is attributed in the logs.
- Prisma Studio is never exposed publicly: run it on the server and reach it through `ssh -L 5555:localhost:5555`.
- If the database moves to Postgres, give each admin their own database login inside the tunnel for finer-grained audit.
