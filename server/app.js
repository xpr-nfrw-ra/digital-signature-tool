// app.js - Express application (middleware + routes), without the HTTPS listener.
// server.js starts it in production; tests load it directly.
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const authRoutes = require('./auth');
const settingsRoutes = require('./settings').router;
const keysRoutes = require('./keys').router;
const signaturesRoutes = require('./signatures').router;
const { PrismaSessionStore } = require('./sessionStore');

const app = express();

// Security headers (disable CSP to allow inline styles/scripts in the client app)
app.use(helmet({ contentSecurityPolicy: false }));

// Parse JSON request bodies
app.use(express.json());

// Session configuration — sessions persisted in SQLite via Prisma so they survive restarts.
// 2-hour sliding idle timeout: any authenticated request refreshes `expires_at`.
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore({ defaultMaxAgeMs: SESSION_MAX_AGE_MS }),
    cookie: {
        secure: true,
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_MS
    }
}));

// Auth API routes
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/signatures', signaturesRoutes);

// Serve static client files
app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = { app, SESSION_MAX_AGE_MS };
