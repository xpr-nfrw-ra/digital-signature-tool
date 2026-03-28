# Digital Signature Tool

## Project Structure
- `public/` — Client-side files served by Express (HTML, CSS, JS, forge.min.js)
- `server/` — Node.js/Express backend (authentication, serves static files)
- `scripts/` — Certificate generation scripts (OpenSSL, on `https-openssl-ca` branch)
- `data/` — Runtime data (users.json, gitignored)
- `certs/` — SSL certificates (gitignored)

## Branches

### `main` — HTTPS with self-signed certificate (original)
```
npm install
npm run generate-certs   # one-time: creates self-signed SSL cert via node-forge
npm start                # HTTPS on port 3443
```
Open https://localhost:3443 (accept the self-signed cert warning).

### `http-demo` — Insecure HTTP (Wireshark demo)
```
npm install
npm start                # HTTP on port 3000
```
Open http://localhost:3000 and log in. In Wireshark, filter `tcp.port == 3000 && http` to see login credentials in plaintext POST bodies.

### `https-openssl-ca` — HTTPS with OpenSSL CA chain
```
npm install
npm run generate-ca-chain   # builds Root CA → Intermediate CA → Server cert
npm start                   # HTTPS on port 3443
```
To avoid browser certificate warnings, import `certs/rootCA.crt` into your OS trusted root store:
- **Windows**: `certmgr.msc` → Trusted Root Certification Authorities → Certificates → Import
- **Chrome/Edge** inherits the Windows trust store automatically

Open https://localhost:3443. In Wireshark, filter `tcp.port == 3443` — only TLS records are visible; credentials are encrypted.

## Architecture
- Authentication: Express + bcryptjs + express-session (session-based, secure cookies)
- User storage: JSON file (`data/users.json`) via `server/userStore.js` — swap this file to add a real database
- Crypto operations (signing, verification, key generation): 100% client-side using forge.js
- Private keys never leave the browser

## Key Conventions
- All `userStore.js` functions are async (ready for database migration)
- Auth routes are in `server/auth.js`, mounted at `/api/auth`
- Frontend auth logic is in `public/js/auth.js` — makes fetch() calls to the backend
- Client-side fetch calls use relative URLs, so they work on both HTTP and HTTPS with no code changes
- No build tools or bundlers — vanilla JS
