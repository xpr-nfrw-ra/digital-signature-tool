// server.js - Express HTTP server (INSECURE — for Wireshark demo only)
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const authRoutes = require('./auth');
const userStore = require('./userStore');

const app = express();
const PORT = 3000;

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
        secure: false,  // INSECURE: allows cookies over plain HTTP
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

    http.createServer(app).listen(PORT, () => {
        console.log(`HTTP server running on http://localhost:${PORT}`);
        console.log('WARNING: Traffic is unencrypted — credentials visible to network sniffers');
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
