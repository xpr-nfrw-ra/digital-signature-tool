const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
    prisma, PASSWORD, client, registeredClient, uniqueUsername, cleanup,
} = require('./helpers');

after(cleanup);

describe('register', () => {
    it('creates the user, default settings and a logged-in session', async () => {
        const c = client();
        const username = uniqueUsername('reg');
        const res = await c.post('/api/auth/register', { username, password: PASSWORD });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { success: true, user: { username } });

        const user = await prisma.user.findUnique({ where: { username } });
        assert.ok(user);
        assert.notEqual(user.passwordHash, PASSWORD, 'password must be stored hashed');
        assert.match(user.passwordHash, /^\$2[aby]\$10\$/);
        assert.ok(await prisma.userSettings.findUnique({ where: { userId: user.id } }));

        const me = await c.get('/api/auth/me');
        assert.equal(me.status, 200);
        assert.equal(me.body.user.username, username);
    });

    it('issues an HttpOnly, Secure session cookie', async () => {
        const c = client();
        const res = await c.post('/api/auth/register', { username: uniqueUsername('cookie'), password: PASSWORD });
        const cookie = res.headers['set-cookie'].find(s => s.startsWith('connect.sid='));
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /Secure/i);
    });

    it('rejects a duplicate username with 409', async () => {
        const { username } = await registeredClient('dup');
        const res = await client().post('/api/auth/register', { username, password: PASSWORD });
        assert.equal(res.status, 409);
    });

    it('rejects invalid usernames and passwords with 400', async () => {
        const c = client();
        for (const body of [
            { username: 'ab', password: PASSWORD },              // too short
            { username: 'bad name!', password: PASSWORD },       // forbidden characters
            { username: uniqueUsername('pw'), password: '123' }, // password too short
            { username: uniqueUsername('pw') },                  // missing password
        ]) {
            const res = await c.post('/api/auth/register', body);
            assert.equal(res.status, 400, JSON.stringify(body));
        }
    });
});

describe('login / logout / me', () => {
    it('logs in with correct credentials', async () => {
        const { username } = await registeredClient('login');
        const c = client();
        const res = await c.post('/api/auth/login', { username, password: PASSWORD });
        assert.equal(res.status, 200);
        assert.equal((await c.get('/api/auth/me')).status, 200);
    });

    it('returns the same 401 for a wrong password and an unknown user', async () => {
        const { username } = await registeredClient('login401');
        const wrongPw = await client().post('/api/auth/login', { username, password: 'Wrong-pass-123!' });
        const noUser = await client().post('/api/auth/login', { username: uniqueUsername('ghost'), password: PASSWORD });
        assert.equal(wrongPw.status, 401);
        assert.equal(noUser.status, 401);
        assert.deepEqual(wrongPw.body, noUser.body, 'responses must not reveal whether the user exists');
    });

    it('me returns 401 without a session', async () => {
        assert.equal((await client().get('/api/auth/me')).status, 401);
    });

    it('logout destroys the session row and the old cookie stops working', async () => {
        const { client: c, userId } = await registeredClient('logout');
        const oldCookie = c.cookie;
        assert.equal(await prisma.session.count({ where: { userId } }), 1);

        assert.equal((await c.post('/api/auth/logout')).status, 200);
        assert.equal(await prisma.session.count({ where: { userId } }), 0);

        const replay = client();
        replay.cookie = oldCookie;
        assert.equal((await replay.get('/api/auth/me')).status, 401);
    });
});

describe('sessions', () => {
    it('login issues a new session ID and invalidates the previous one (no fixation)', async () => {
        const { client: c, username } = await registeredClient('fixation');
        const before = c.cookie;
        await c.post('/api/auth/login', { username, password: PASSWORD });
        assert.notEqual(c.cookie, before);

        const replay = client();
        replay.cookie = before;
        assert.equal((await replay.get('/api/auth/me')).status, 401);
    });

    it('an expired session row is rejected and deleted', async () => {
        const { client: c, userId } = await registeredClient('expired');
        await prisma.session.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });

        assert.equal((await c.get('/api/auth/me')).status, 401);
        assert.equal(await prisma.session.count({ where: { userId } }), 0);
    });

    it('authenticated requests push expires_at forward (sliding window)', async () => {
        const { client: c, userId } = await registeredClient('sliding');
        const soon = new Date(Date.now() + 60 * 1000);
        await prisma.session.updateMany({ where: { userId }, data: { expiresAt: soon } });

        assert.equal((await c.get('/api/settings')).status, 200);
        const row = await prisma.session.findFirst({ where: { userId } });
        assert.ok(row.expiresAt.getTime() > Date.now() + 60 * 60 * 1000, 'expiry should be ~2h out again');
    });
});

describe('change username', () => {
    it('requires the current password', async () => {
        const { client: c } = await registeredClient('rename');
        const res = await c.put('/api/auth/username', { currentPassword: 'Wrong-pass-123!', newUsername: uniqueUsername('new') });
        assert.equal(res.status, 401);
    });

    it('rejects a username that is already taken', async () => {
        const { username: taken } = await registeredClient('taken');
        const { client: c } = await registeredClient('rename');
        const res = await c.put('/api/auth/username', { currentPassword: PASSWORD, newUsername: taken });
        assert.equal(res.status, 409);
    });

    it('renames the user; the new name works for login and the session is updated', async () => {
        const { client: c, username } = await registeredClient('rename');
        const newUsername = uniqueUsername('renamed');
        const res = await c.put('/api/auth/username', { currentPassword: PASSWORD, newUsername });
        assert.equal(res.status, 200);
        assert.equal((await c.get('/api/auth/me')).body.user.username, newUsername);

        assert.equal((await client().post('/api/auth/login', { username: newUsername, password: PASSWORD })).status, 200);
        assert.equal((await client().post('/api/auth/login', { username, password: PASSWORD })).status, 401);
    });
});

describe('change password', () => {
    const NEW_PASSWORD = 'New-pass-456!';

    it('requires the current password', async () => {
        const { client: c } = await registeredClient('pw');
        const res = await c.put('/api/auth/password', { currentPassword: 'Wrong-pass-123!', newPassword: NEW_PASSWORD });
        assert.equal(res.status, 401);
    });

    it('changes the password and rotates the session ID', async () => {
        const { client: c, username } = await registeredClient('pw');
        const before = c.cookie;
        const res = await c.put('/api/auth/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
        assert.equal(res.status, 200);
        assert.notEqual(c.cookie, before);
        assert.equal((await c.get('/api/auth/me')).status, 200);

        const replay = client();
        replay.cookie = before;
        assert.equal((await replay.get('/api/auth/me')).status, 401);

        assert.equal((await client().post('/api/auth/login', { username, password: PASSWORD })).status, 401);
        assert.equal((await client().post('/api/auth/login', { username, password: NEW_PASSWORD })).status, 200);
    });
});

describe('password minimum length', () => {
    it('new accounts need at least 8 characters', async () => {
        const c = client();
        assert.equal((await c.post('/api/auth/register', { username: uniqueUsername('short'), password: '1234567' })).status, 400);
        assert.equal((await c.post('/api/auth/register', { username: uniqueUsername('ok'), password: '12345678' })).status, 200);
    });

    it('an existing account with a 6-character password can still log in and manage itself', async () => {
        // Accounts created when the minimum was 6 have short passwords; insert one directly.
        const bcrypt = require('bcryptjs');
        const username = uniqueUsername('legacy');
        await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash('123456', 10) } });

        const c = client();
        assert.equal((await c.post('/api/auth/login', { username, password: '123456' })).status, 200);

        const renamed = uniqueUsername('legacy2');
        assert.equal((await c.put('/api/auth/username', { currentPassword: '123456', newUsername: renamed })).status, 200);

        // Moving to a new password enforces the new minimum...
        assert.equal((await c.put('/api/auth/password', { currentPassword: '123456', newPassword: '1234567' })).status, 400);
        assert.equal((await c.put('/api/auth/password', { currentPassword: '123456', newPassword: 'Longer-pass-1' })).status, 200);
        // ...and the old short password stops working.
        assert.equal((await client().post('/api/auth/login', { username: renamed, password: '123456' })).status, 401);
        assert.equal((await client().post('/api/auth/login', { username: renamed, password: 'Longer-pass-1' })).status, 200);
    });

    it('a short-password account can delete itself', async () => {
        const bcrypt = require('bcryptjs');
        const username = uniqueUsername('legacydel');
        await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash('abcdef', 10) } });
        const c = client();
        await c.post('/api/auth/login', { username, password: 'abcdef' });
        assert.equal((await c.delete('/api/auth/account', { currentPassword: 'abcdef' })).status, 200);
    });
});

describe('rate limiting', () => {
    it('blocks login from an IP after 10 wrong passwords, even with the right one', async () => {
        const { username } = await registeredClient('rl');
        const attacker = client();
        for (let i = 0; i < 10; i++) {
            const res = await attacker.post('/api/auth/login', { username, password: 'Wrong-pass-123!' });
            assert.equal(res.status, 401);
        }
        const blocked = await attacker.post('/api/auth/login', { username, password: PASSWORD });
        assert.equal(blocked.status, 429);
        assert.ok(blocked.body.error);
        assert.ok(blocked.headers['retry-after']);

        // Other IPs are unaffected.
        assert.equal((await client().post('/api/auth/login', { username, password: PASSWORD })).status, 200);
    });

    it('successful logins do not count toward the login limit', async () => {
        const { username } = await registeredClient('rlok');
        const c = client();
        for (let i = 0; i < 12; i++) {
            assert.equal((await c.post('/api/auth/login', { username, password: PASSWORD })).status, 200);
        }
    });

    it('limits registrations to 10 per IP', async () => {
        const c = client();
        for (let i = 0; i < 10; i++) {
            const res = await c.post('/api/auth/register', { username: uniqueUsername('rlreg'), password: PASSWORD });
            assert.equal(res.status, 200);
        }
        const res = await c.post('/api/auth/register', { username: uniqueUsername('rlreg'), password: PASSWORD });
        assert.equal(res.status, 429);
    });

    it('limits wrong current-password attempts to 5 per user; other errors do not count', async () => {
        const { client: c } = await registeredClient('rlre');
        for (let i = 0; i < 6; i++) {
            // 400 "must differ" — not a password failure
            const res = await c.put('/api/auth/password', { currentPassword: PASSWORD, newPassword: PASSWORD });
            assert.equal(res.status, 400);
        }
        for (let i = 0; i < 5; i++) {
            const res = await c.put('/api/auth/password', { currentPassword: 'Wrong-pass-123!', newPassword: 'New-pass-456!' });
            assert.equal(res.status, 401);
        }
        const blocked = await c.put('/api/auth/username', { currentPassword: PASSWORD, newUsername: uniqueUsername('x') });
        assert.equal(blocked.status, 429, 'username and password change share the per-user limit');
    });
});
