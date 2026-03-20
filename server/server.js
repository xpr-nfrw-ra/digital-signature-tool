// server.js - Express HTTPS server
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const authRoutes = require('./auth');
const userStore = require('./userStore');

const app = express();
const PORT = 3443;

// Security headers (disable CSP to allow inline styles/scripts in the client app)
app.use(helmet({ contentSecurityPolicy: false }));

// Parse JSON request bodies
app.use(express.json());

// Session configuration
app.use(session({
    secret: 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Auth API routes
app.use('/api/auth', authRoutes);

// Serve static client files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Start server
async function start() {
    await userStore.initialize();

    const certDir = path.join(__dirname, '..', 'certs');
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        console.error('SSL certificates not found. Run: npm run generate-certs');
        process.exit(1);
    }

    const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };

    https.createServer(sslOptions, app).listen(PORT, () => {
        console.log(`HTTPS server running on https://localhost:${PORT}`);
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
