// auth.js - Authentication routes
const express = require('express');
const bcrypt = require('bcryptjs');
const userStore = require('./userStore');
const { prisma } = userStore;
const { validate } = require('./validators');
const { ensureSettings } = require('./settings');
const { requireAuth, loginLimiter, registerLimiter, reauthLimiter } = require('./middleware');

const router = express.Router();

const SALT_ROUNDS = 10;

// Usernames are unique regardless of case, so nobody can register "Alice" next to "alice"
// and pass as them in key lookups. The stored spelling is kept as typed.
async function usernameTaken(username, exceptUserId = 0) {
    const rows = await prisma.$queryRaw`
        SELECT id FROM users WHERE username = ${username} COLLATE NOCASE AND id <> ${exceptUserId} LIMIT 1`;
    return rows.length > 0;
}

// Prisma's unique-constraint error: two requests raced past the check above.
const isUniqueViolation = err => err && err.code === 'P2002';

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const err = validate({ username, password });
        if (err) {
            return res.status(400).json({ error: err });
        }

        if (await usernameTaken(username.trim())) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        let user;
        try {
            user = await userStore.createUser(username.trim(), hashedPassword);
        } catch (createErr) {
            if (isUniqueViolation(createErr)) return res.status(409).json({ error: 'Username already taken' });
            throw createErr;
        }
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
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const err = validate({ username, currentPassword: password });
        if (err) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = await userStore.findUserByUsername(username.trim());
        if (!user || user.deletedAt) {
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

// GET /api/auth/me — read from the database, not the session, so a username changed on
// another device shows up here too.
router.get('/me', async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
        if (!user || user.deletedAt) {
            return req.session.destroy(() => res.status(401).json({ error: 'Not authenticated' }));
        }
        if (user.username !== req.session.user.username) {
            req.session.user = { id: user.id, username: user.username };
        }
        res.json({ user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ error: 'Failed to load the current user' });
    }
});

// PUT /api/auth/username — change the logged-in user's username.
// Requires current password re-confirmation.
router.put('/username', requireAuth, reauthLimiter, async (req, res) => {
    try {
        const { currentPassword, newUsername } = req.body;

        if (!currentPassword || !newUsername) {
            return res.status(400).json({ error: 'Current password and new username are required' });
        }
        const validationErr = validate({ username: newUsername, currentPassword });
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

        // Excluding this user lets someone change only the case of their own name.
        if (await usernameTaken(trimmed, user.id)) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        let updated;
        try {
            updated = await prisma.user.update({
                where: { id: user.id },
                data: { username: trimmed },
            });
        } catch (updateErr) {
            if (isUniqueViolation(updateErr)) return res.status(409).json({ error: 'Username already taken' });
            throw updateErr;
        }
        req.session.user = { id: updated.id, username: updated.username };
        res.json({ success: true, user: { username: updated.username } });
    } catch (err) {
        console.error('Username change error:', err);
        res.status(500).json({ error: 'Username change failed' });
    }
});

// PUT /api/auth/password — change the logged-in user's password.
// Requires current password re-confirmation. Logs out every other session (someone who
// stole a session must not outlive the password change) and rotates this one's ID.
router.put('/password', requireAuth, reauthLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }
        const validationErr = validate({ currentPassword, password: newPassword });
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
        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: newHash },
            }),
            // Includes this request's own session; regenerate() below issues a fresh one.
            prisma.session.deleteMany({ where: { userId: user.id } }),
        ]);

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

// DELETE /api/auth/account — soft-delete the logged-in user's account.
// Requires current password re-confirmation. Public keys and signing history are kept
// (signature_log is the audit trail and must outlive the account); the username is
// freed, the password hash scrubbed, and settings and every session removed.
router.delete('/account', requireAuth, reauthLimiter, async (req, res) => {
    try {
        const { currentPassword } = req.body || {};

        if (!currentPassword) {
            return res.status(400).json({ error: 'Current password is required' });
        }
        const validationErr = validate({ currentPassword });
        if (validationErr) {
            return res.status(400).json({ error: validationErr });
        }

        const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
        if (!user || user.deletedAt) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const match = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!match) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: {
                    // ':' is not allowed in usernames, so this can never collide with
                    // a real account, and the original name becomes free to register.
                    username: `deleted:${user.id}`,
                    // Not a bcrypt hash, so no password can ever match it.
                    passwordHash: '!deleted',
                    deletedAt: new Date(),
                },
            }),
            prisma.userSettings.deleteMany({ where: { userId: user.id } }),
            prisma.session.deleteMany({ where: { userId: user.id } }),
        ]);

        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ success: true });
        });
    } catch (err) {
        console.error('Account deletion error:', err);
        res.status(500).json({ error: 'Account deletion failed' });
    }
});

module.exports = router;
