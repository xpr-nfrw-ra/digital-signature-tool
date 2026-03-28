# Digital Signature Tool — Insecure HTTP (Wireshark Demo)

A browser-based tool for creating and verifying digital signatures. All cryptographic operations run entirely in the browser — private keys never leave your machine.

This branch (`http-demo`) intentionally runs over plain **HTTP** with no encryption. Its purpose is to demonstrate — using Wireshark — how login credentials are exposed in plaintext when TLS is absent. Do not use this in any environment where traffic could be observed by others.

## Features

- **File Signing** — sign any file with an RSA private key
- **Signature Verification** — verify a file's authenticity against a public key
- **Key Generation** — generate RSA key pairs (2048 / 3072 / 4096 bits)
- **User Accounts** — session-based authentication (insecure cookies over HTTP)
- **Guest Mode** — use signing/verification without an account

## Requirements

- [Node.js](https://nodejs.org/) v16 or higher

## Setup & Running

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm start
```

No certificate generation needed — this branch uses plain HTTP.

### 3. Open the app

Navigate to **http://localhost:3000**.

## Demonstrating with Wireshark

1. Open Wireshark and start a capture on the loopback adapter (`lo` on Linux/Mac, "Npcap Loopback Adapter" on Windows)
2. Apply the display filter: `tcp.port == 3000 && http`
3. Register or log in via the browser
4. In Wireshark, find the `POST /api/auth/login` or `POST /api/auth/register` packet and inspect the HTTP body — the username and password appear in plaintext

This contrasts with the `main` and `https-openssl-ca` branches where the same request body is encrypted inside a TLS record and is not readable in the capture.

## Project Structure

```
digital-signature-tool/
├── public/              # Client-side files (HTML, CSS, JS, forge.js)
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── lib/
├── server/              # Node.js/Express backend
│   ├── server.js        # Entry point, HTTP server (port 3000)
│   ├── auth.js          # Auth routes (/api/auth/*)
│   └── userStore.js     # JSON-file user storage
├── data/                # Runtime data — gitignored
│   └── users.json
└── package.json
```

## Security Warning

This branch is for **educational/demo purposes only**. Passwords are transmitted in plaintext and session cookies are not secure-flagged.
