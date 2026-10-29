# Roadmap

What's left, what still needs deciding, and why things are the way they are. [README.md](README.md) describes the system as it is; this file describes where it's going. Tick items off and move settled questions into the decision log as work lands.

## Status

### Done
- [x] Backend structure and persistence: Express route modules, Prisma + SQLite, 5 tables, versioned migrations, explicit on-delete rules, central validation
- [x] Sessions in the database, 2h sliding expiry, session-ID rotation on login and password change
- [x] Username and password change with current-password re-confirmation
- [x] HTTPS with a local Root CA → Intermediate CA → server certificate chain
- [x] Public key directory (lookup by exact username or fingerprint) and signing audit log
- [x] Fresh-clone setup works (`setup.bat` creates `.env`, migrates, generates certs)
- [x] `SESSION_SECRET` and `DATABASE_URL` from `.env`
- [x] Rate limiting on login, register and password re-confirmation

### Next, in order
1. [ ] **Automated tests.** Split the Express app from the HTTPS listener (`server/app.js`), add Vitest + Supertest with a separate `DATABASE_URL` test database, and cover auth, session behaviour, rate limits, `requireAuth`, ownership checks, validators, key lookup and the signature log. Then a hook that runs `npm test` after server edits.
2. [ ] **Signing history pagination** — cursor-based `GET /signatures/mine?limit=&cursor=`. The frontend doesn't show history yet, so a history view is an optional follow-up.
3. [ ] **Audit log lookup by document hash**, with an index on `signature_log.document_hash`. *Needs decision D1.*
4. [ ] **Account deletion** with current-password re-confirmation. *Needs decision D2.*
5. [ ] **ECDSA**: today the browser generates RSA keys when ECDSA is selected (`public/js/crypto.js`). *Needs decision D3.* The backend change is only `ALLOWED_SIG` in `server/settings.js`.
6. [ ] **Production deployment** — once there is a target server. See the plan below.

### Smaller items
- [ ] Minimum password length is 6 (`server/validators.js`); consider raising it to 8–12.
- [ ] Optional: a "log out other sessions" view (would need IP / user-agent / last-seen stored per session, which is deliberately not done today).

## Open decisions

- **D1. Who can look up the audit log by document hash?** Only the caller's own entries, or anyone's (answers "did X sign this file?", but reveals who signed what)? Leaning: anyone's, behind `requireAuth`, returning username + key fingerprint + time — consistent with public key lookup.
- **D2. What happens to the audit trail when an account is deleted?** `signature_log` and `public_keys` block user deletion (RESTRICT). Leaning: soft delete — add `users.deleted_at`, scrub the password hash, rename the username to free it, keep keys and log rows so past signatures stay verifiable; sessions and settings are removed. Alternative: hard delete only for users with no signing history.
- **D3. ECDSA: implement or remove?** Implement with the Web Crypto API (P-256/P-384, SPKI PEM export so fingerprints still work), or remove the option and reset stored `ecdsa` settings with a migration.

## Decision log

- **No roles, no admin.** Every operation is "act on my own data", so a `role` column would be dead schema. If admin features appear: add `users.role`, a `requireAdmin` middleware, and apply it on top of `requireAuth`.
- **Audit trail outlives accounts and keys.** `signature_log` foreign keys are RESTRICT, so a signing record can never be removed as a side effect of deleting a user or key.
- **No list-all public keys endpoint.** Lookup needs an exact username or fingerprint, which limits passive enumeration.
- **No per-username login lockout.** It would let anyone lock a victim out. Rate limits are per IP (login, register) and per user (re-auth routes), and only wrong-password (401) responses count.
- **Rate-limit counters in memory.** Fine for a single instance; they reset on restart. Revisit if the app runs on multiple processes.
- **Sessions don't store IP or user-agent.** Nothing uses them yet, and they add PII and a write on every request.
- **Validation in the app, not the database.** SQLite ignores `VARCHAR(n)` and has no regex, so `server/validators.js` is the single place for length and format rules.
- **No SHA-3.** forge.js doesn't ship it, and there's no compelling use case.
- **Admin access through the OS, not through a web login for Prisma Studio.** Studio has no auth hooks and SQLite has no database users, so filesystem permissions are the real access boundary (see below).

## Production deployment plan

Not started; applies once the app moves off the developer laptop.

- Run the app as a dedicated service user (e.g. `signtool`) under systemd. Keep `dev.db` outside the repo, owned by that user, mode `0600`.
- Supply `SESSION_SECRET` and `DATABASE_URL` through systemd `EnvironmentFile=` or a secrets manager — not a `.env` in the repo directory.
- Replace the local CA with a real certificate.
- SSH with keys only (ideally plus MFA). Each admin has their own Linux account; a `db_admins` group gets `sudo -u signtool` rights for `sqlite3` and `prisma studio` only, so every action is attributed in the logs.
- Prisma Studio is never exposed publicly: run it on the server and reach it through `ssh -L 5555:localhost:5555`.
- If the database moves to Postgres, give each admin their own database login inside the tunnel for finer-grained audit.
