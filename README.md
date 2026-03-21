# Digital Signature Tool

A browser-based tool for creating and verifying digital signatures. All cryptographic operations run entirely in the browser — private keys never leave your machine.

## Features

- **File Signing** — sign any file with an RSA private key
- **Signature Verification** — verify a file's authenticity against a public key
- **Key Generation** — generate RSA key pairs (2048 / 3072 / 4096 bits)
- **User Accounts** — session-based authentication with secure HTTPS cookies
- **Guest Mode** — use signing/verification without an account

## Requirements

- [Node.js](https://nodejs.org/) v16 or higher
- npm (included with Node.js)

## Setup & Running

### 1. Install dependencies

```bash
npm install
```

### 2. Generate SSL certificates (one-time)

```bash
npm run generate-certs
```

This creates a self-signed certificate in the `certs/` directory, required for the HTTPS server.

### 3. Start the server

```bash
npm start
```

### 4. Open the app

Navigate to **https://localhost:3443** in your browser.

> Your browser will show a security warning because the certificate is self-signed. This is expected — click **Advanced** → **Proceed to localhost** (or equivalent) to continue.

## Project Structure

```
digital-signature-tool/
├── public/          # Client-side files (HTML, CSS, JS, forge.js)
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── lib/
├── server/          # Node.js/Express backend
│   ├── index.js     # Entry point, HTTPS server
│   ├── auth.js      # Auth routes (/api/auth/*)
│   └── userStore.js # JSON-file user storage
├── data/            # Runtime data — gitignored
│   └── users.json
├── certs/           # SSL certs — gitignored
└── package.json
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Port | `3443` | HTTPS port (set in `server/index.js`) |
| User storage | `data/users.json` | Swap `server/userStore.js` to use a real database |

## Security Notes

- Private keys are generated and used entirely in the browser; they are never sent to the server.
- Passwords are hashed with bcrypt before storage.
- Sessions use secure, HTTP-only cookies over HTTPS.
- For production use, replace the self-signed certificate with one from a trusted CA.
