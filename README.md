# Digital Signature Tool — HTTPS with Self-Signed Certificate

A browser-based tool for creating and verifying digital signatures. All cryptographic operations run entirely in the browser — private keys never leave your machine.

This branch (`main`) runs over HTTPS using a self-signed certificate generated with node-forge (no OpenSSL required). The browser will show a one-time security warning that you dismiss manually.

## Features

- **File Signing** — sign any file with an RSA private key
- **Signature Verification** — verify a file's authenticity against a public key
- **Key Generation** — generate RSA key pairs (2048 / 3072 / 4096 bits)
- **User Accounts** — session-based authentication with secure HTTPS cookies
- **Guest Mode** — use signing/verification without an account

## Requirements

- [Node.js](https://nodejs.org/) v16 or higher

## Setup & Running

### 1. Install dependencies

```bash
npm install
```

### 2. Generate the self-signed certificate (one-time)

```bash
npm run generate-certs
```

This uses node-forge to create `certs/key.pem` and `certs/cert.pem` (valid for 1 year, SANs for `localhost` and `127.0.0.1`).

### 3. Start the server

```bash
npm start
```

### 4. Open the app

Navigate to **https://localhost:3443**.

The browser will show a "Your connection is not private" warning because the certificate is self-signed and not trusted by any CA. This is expected — click **Advanced** → **Proceed to localhost** (or equivalent) to continue.

## Project Structure

```
digital-signature-tool/
├── public/              # Client-side files (HTML, CSS, JS, forge.js)
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── lib/
├── server/              # Node.js/Express backend
│   ├── server.js        # Entry point, HTTPS server (port 3443)
│   ├── generate-certs.js# Self-signed cert generation (node-forge)
│   ├── auth.js          # Auth routes (/api/auth/*)
│   └── userStore.js     # JSON-file user storage
├── data/                # Runtime data — gitignored
│   └── users.json
├── certs/               # Generated certificates — gitignored
└── package.json
```

## Security Notes

- Private keys are generated and used entirely in the browser; they are never sent to the server.
- Passwords are hashed with bcrypt before storage.
- Sessions use secure, HTTP-only cookies over HTTPS.
- The self-signed certificate is for local development only. For a trusted certificate, see the `https-openssl-ca` branch.
