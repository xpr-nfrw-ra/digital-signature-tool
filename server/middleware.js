// middleware.js - Shared Express middleware
const { rateLimit } = require('express-rate-limit');

function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// Rate limiters for password-checking endpoints (brute-force protection).
// Counters live in memory: they reset on server restart and are per-process,
// which is fine for a single-instance deployment.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function limiter(options) {
    return rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many attempts. Please try again in 15 minutes.' },
        ...options,
    });
}

// Only wrong-credential responses (401) count against these limits, so a successful
// login or an unrelated error (e.g. "username already taken") never locks anyone out.
const countOnlyAuthFailures = {
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
};

// Login: 10 failed attempts per IP per window.
const loginLimiter = limiter({ limit: 10, ...countOnlyAuthFailures });

// Registration: 10 attempts per IP per window, successful or not (limits account spam).
const registerLimiter = limiter({ limit: 10 });

// Username/password change re-confirm the current password, so a stolen session
// could otherwise brute-force it. Keyed by user id; runs after requireAuth.
const reauthLimiter = limiter({
    limit: 5,
    ...countOnlyAuthFailures,
    keyGenerator: req => `user:${req.session.user.id}`,
});

module.exports = { requireAuth, loginLimiter, registerLimiter, reauthLimiter };
