// server.js - Entry point: loads config, then serves the Express app over HTTPS (OpenSSL CA chain)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error('SESSION_SECRET is missing or shorter than 32 characters. Set it in .env (see .env.example).');
    process.exit(1);
}

const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('./app');
const userStore = require('./userStore');
const { cleanupExpiredSessions } = require('./sessionStore');

const PORT = 3443;

// Start server
async function start() {
    await userStore.initialize();

    const purged = await cleanupExpiredSessions();
    if (purged > 0) {
        console.log(`Purged ${purged} expired session(s).`);
    }

    const certDir = path.join(__dirname, '..', 'certs');
    const keyPath = path.join(certDir, 'server.key');
    const certPath = path.join(certDir, 'server.crt');
    const chainPath = path.join(certDir, 'chain.crt');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath) || !fs.existsSync(chainPath)) {
        console.error('SSL certificates not found. Run: npm run generate-ca-chain');
        process.exit(1);
    }

    const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        ca: fs.readFileSync(chainPath)
    };

    https.createServer(sslOptions, app).listen(PORT, () => {
        console.log(`HTTPS server running on https://localhost:${PORT}`);
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
