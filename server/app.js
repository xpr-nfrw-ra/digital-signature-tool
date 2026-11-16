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

// Security headers, including a strict Content Security Policy: scripts, styles and
// fonts only from this origin, no inline scripts or style attributes, no framing.
// Private keys live in the browser, so injected script must never be able to run.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            'style-src': ["'self'"],
            'font-src': ["'self'"],
            'frame-ancestors': ["'none'"],
        },
    },
}));

// Parse JSON request bodies
app.use(express.json());

// Session configuration — sessions persisted in SQLite via Prisma so they survive restarts.
// 2-hour sliding idle timeout: every request with a session refreshes both `expires_at`
// in the store and the browser cookie (`rolling`), so only 2 idle hours log you out.
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new PrismaSessionStore({ defaultMaxAgeMs: SESSION_MAX_AGE_MS }),
    cookie: {
        secure: true,
        httpOnly: true,
        // The page and its API share one origin, so the cookie never needs to travel
        // with a request started by another site.
        sameSite: 'strict',
        maxAge: SESSION_MAX_AGE_MS
    }
}));

// Auth API routes
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/signatures', signaturesRoutes);

// Unknown API routes answer in JSON like the rest of the API.
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Serve static client files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Errors raised before a route runs (malformed JSON, oversized body) or thrown past one.
// Answer with a short JSON message; never send the stack trace to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error('Unhandled error:', err);
    const messages = {
        'entity.parse.failed': 'Malformed request body',
        'entity.too.large': 'Request body is too large',
    };
    res.status(status).json({ error: messages[err.type] || (status === 500 ? 'Internal server error' : 'Bad request') });
});

module.exports = { app, SESSION_MAX_AGE_MS };
