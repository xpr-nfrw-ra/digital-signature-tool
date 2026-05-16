// auth.js - Authentication routes
const express = require('express');
const bcrypt = require('bcryptjs');
const userStore = require('./userStore');
const { prisma } = userStore;
const { validate } = require('./validators');
const { ensureSettings } = require('./settings');
const { requireAuth } = require('./middleware');

const router = express.Router();

const SALT_ROUNDS = 10;

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const err = validate({ username, password });
        if (err) {
            return res.status(400).json({ error: err });
        }

        const existing = await userStore.findUserByUsername(username.trim());
        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const user = await userStore.createUser(username.trim(), hashedPassword);
        await ensureSettings(user.id);

        req.session.regenerate(regenErr => {
            if (regenErr) {
                console.error('Session regenerate error:', regenErr);
                return res.status(500).json({ error: 'Registration failed' });
            }
            req.session.user = { id: user.id, username: user.username };
            res.json({ success: true, user: { username: user.username } });
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const err = validate({ username, password });
        if (err) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = await userStore.findUserByUsername(username.trim());
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.regenerate(regenErr => {
            if (regenErr) {
                console.error('Session regenerate error:', regenErr);
                return res.status(500).json({ error: 'Login failed' });
            }
            req.session.user = { id: user.id, username: user.username };
            res.json({ success: true, user: { username: user.username } });
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// PUT /api/auth/username — change the logged-in user's username.
// Requires current password re-confirmation.
router.put('/username', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newUsername } = req.body;

        if (!currentPassword || !newUsername) {
            return res.status(400).json({ error: 'Current password and new username are required' });
        }
        const validationErr = validate({ username: newUsername, password: currentPassword });
        if (validationErr) {
            return res.status(400).json({ error: validationErr });
        }

        const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const match = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!match) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const trimmed = newUsername.trim();
        if (trimmed === user.username) {
            return res.status(400).json({ error: 'New username must differ from the current one' });
        }

        const conflict = await prisma.user.findUnique({ where: { username: trimmed } });
        if (conflict) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const updated = await prisma.user.update({
            where: { id: user.id },
            data: { username: trimmed },
        });
        req.session.user = { id: updated.id, username: updated.username };
        res.json({ success: true, user: { username: updated.username } });
    } catch (err) {
        console.error('Username change error:', err);
        res.status(500).json({ error: 'Username change failed' });
    }
});

// PUT /api/auth/password — change the logged-in user's password.
// Requires current password re-confirmation. Rotates the session ID on success.
router.put('/password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }
        const validationErr = validate({ password: newPassword });
        if (validationErr) {
            return res.status(400).json({ error: validationErr });
        }
        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'New password must differ from the current one' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const match = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!match) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash },
        });

        const sessionUser = { id: user.id, username: user.username };
        req.session.regenerate(regenErr => {
            if (regenErr) {
                console.error('Session regenerate error:', regenErr);
                return res.status(500).json({ error: 'Password changed, but session refresh failed — please log in again' });
            }
            req.session.user = sessionUser;
            res.json({ success: true });
        });
    } catch (err) {
        console.error('Password change error:', err);
        res.status(500).json({ error: 'Password change failed' });
    }
});

module.exports = router;
