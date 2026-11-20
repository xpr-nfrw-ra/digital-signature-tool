// server.js - Entry point: loads config, then serves the Express app over HTTPS (OpenSSL CA chain)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error('SESSION_SECRET is missing or shorter than 32 characters. Set it in .env (see .env.example).');
    process.exit(1);
}

const https = require('https');
const http = require('http');
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

    server = https.createServer(sslOptions, app);
    acceptPlainHttpRedirects(server);
    server.listen(PORT, () => {
        console.log(`HTTPS server running on https://localhost:${PORT}`);
    });
}

// One port, two protocols: a TLS connection starts with a handshake record (first byte
// 0x16); anything else is plain HTTP and only gets a redirect to https://. This matters
// when a link opens http:// by default, e.g. Docker Desktop's port links.
// The HTTPS server still listens on the port itself, so Node's connection tracking
// (header/request timeouts, closing idle connections on shutdown) keeps working.
function acceptPlainHttpRedirects(httpsServer) {
    const [tlsConnectionListener] = httpsServer.listeners('connection');
    if (!tlsConnectionListener) throw new Error('HTTPS server has no connection listener');
    httpsServer.removeListener('connection', tlsConnectionListener);

    const redirectServer = http.createServer(redirectToHttps);
    redirectServer.timeout = 10000; // plain-HTTP sockets that stall are dropped

    httpsServer.on('connection', socket => {
        // Wait for the first bytes; drop connections that never send anything.
        socket.setTimeout(10000, () => socket.destroy());
        socket.once('data', chunk => {
            socket.setTimeout(0);
            socket.pause();
            socket.unshift(chunk);
            if (chunk[0] === 0x16) tlsConnectionListener.call(httpsServer, socket);
            else redirectServer.emit('connection', socket);
            process.nextTick(() => socket.resume());
        });
    });
}

// Host names the certificate covers. The port is kept as the browser sent it, so the
// redirect also works when Docker maps the app to a different host port.
const CERT_HOSTS = new Set(['localhost', 'signtool.local', '127.0.0.1']);

function redirectToHttps(req, res) {
    let target = `localhost:${PORT}`;
    try {
        const url = new URL(`http://${req.headers.host}`);
        if (CERT_HOSTS.has(url.hostname)) target = url.host;
    } catch {
        // Missing or malformed Host header: fall back to localhost.
    }
    res.writeHead(301, { Location: `https://${target}${req.url}`, Connection: 'close' });
    res.end();
}

// Graceful shutdown on Ctrl+C (SIGINT) or a stop request from another tool (SIGTERM):
// refuse new requests, let in-flight ones finish, close the database, then exit.
let server;
let shuttingDown = false;

function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down...');

    // Never hang: if something is still busy after 5 seconds, exit anyway.
    setTimeout(() => {
        console.error('Shutdown timed out; exiting.');
        process.exit(1);
    }, 5000).unref();

    const closeDb = async () => {
        await userStore.prisma.$disconnect();
        console.log('Server stopped.');
        process.exit(0);
    };
    if (server) server.close(closeDb);
    else closeDb();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
