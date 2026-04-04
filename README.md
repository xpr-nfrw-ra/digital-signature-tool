# Digital Signature Tool — HTTPS with OpenSSL CA Chain

A browser-based tool for creating and verifying digital signatures. All cryptographic operations run entirely in the browser — private keys never leave your machine.

This branch (`main`) runs over HTTPS using a proper 3-tier PKI: Root CA → Intermediate CA → Server certificate, all generated locally with OpenSSL. Importing the Root CA into your OS trust store gives a genuine green padlock with no browser warnings.

## Features

- **File Signing** — sign any file with an RSA private key
- **Signature Verification** — verify a file's authenticity against a public key
- **Key Generation** — generate RSA key pairs (2048 / 3072 / 4096 bits)
- **User Accounts** — session-based authentication with secure HTTPS cookies
- **Guest Mode** — use signing/verification without an account

## Requirements

- [Node.js](https://nodejs.org/) v16 or higher
- [OpenSSL](https://www.openssl.org/) 1.1+ on your PATH (`openssl version` to verify)

## Setup & Running

### 1. Install dependencies

```bash
npm install
```

### 2. Generate the CA chain (one-time)

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

### 3. Trust the Root CA (optional but recommended)

Without this step the browser shows a certificate warning. With it, you get a proper green padlock.

**Windows (Chrome / Edge inherit this automatically):**
1. Press `Win + R`, type `certmgr.msc`, press Enter
2. Expand **Trusted Root Certification Authorities** → right-click **Certificates** → **All Tasks** → **Import**
3. Browse to `certs/rootCA.crt` → Next → Next → Finish → Yes

**Firefox** (manages its own trust store):
- `about:preferences#privacy` → **View Certificates** → **Authorities** → **Import** → select `certs/rootCA.crt` → check *Trust this CA to identify websites* → OK

Restart the browser after importing.

### 4. Start the server

```bash
npm start
```

### 5. Open the app

Navigate to **https://localhost:3443**.

After importing the Root CA you should see a closed padlock. Click it → **Connection is secure** → **Certificate is valid** to inspect the full chain.

## Project Structure

```
digital-signature-tool/
├── public/              # Client-side files (HTML, CSS, JS, forge.js)
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── lib/
├── scripts/
│   └── gen-ca-chain.sh  # OpenSSL PKI generation script
├── server/              # Node.js/Express backend
│   ├── server.js        # Entry point, HTTPS server (port 3443)
│   ├── auth.js          # Auth routes (/api/auth/*)
│   └── userStore.js     # JSON-file user storage
├── data/                # Runtime data — gitignored
│   └── users.json
├── certs/               # Generated certificates — gitignored
└── package.json
```

## Verifying TLS from the command line

```bash
openssl s_client -connect localhost:3443 -CAfile certs/rootCA.crt
```

Look for `Verify return code: 0 (ok)` to confirm the chain validates correctly.

## Security Notes

- Private keys are generated and used entirely in the browser; they are never sent to the server.
- Passwords are hashed with bcrypt before storage.
- Sessions use secure, HTTP-only cookies over HTTPS.
- The generated Root CA is for local development only — do not use it in production.
