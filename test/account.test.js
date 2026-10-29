const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
    prisma, PASSWORD, client, registeredClient, registerKey, sha256Hex, cleanup,
} = require('./helpers');

after(cleanup);

// A user with a key, one signed document and a second logged-in session.
async function userWithHistory(prefix) {
    const u = await registeredClient(prefix);
    const key = await registerKey(u.client);
    const hash = sha256Hex(`${prefix}-${u.userId}`);
    const res = await u.client.post('/api/signatures', {
        documentName: 'contract.pdf', documentHash: hash, publicKeyFingerprint: key.fingerprint,
    });
    assert.equal(res.status, 201);
    await u.client.put('/api/settings', { defaultPublicKeyId: key.id });

    const otherDevice = client();
    assert.equal((await otherDevice.post('/api/auth/login', { username: u.username, password: PASSWORD })).status, 200);
    return { ...u, key, hash, otherDevice };
}

describe('delete account', () => {
    it('requires a session and the current password', async () => {
        assert.equal((await client().delete('/api/auth/account')).status, 401);

        const { client: c, userId } = await registeredClient('del');
        assert.equal((await c.delete('/api/auth/account')).status, 400);
        const res = await sendDelete(c, 'Wrong-pass-123!');
        assert.equal(res.status, 401);
        assert.equal((await prisma.user.findUnique({ where: { id: userId } })).deletedAt, null);
    });

    it('soft-deletes: scrubs credentials, frees the username, keeps keys and history', async () => {
        const u = await userWithHistory('del');
        const res = await sendDelete(u.client, PASSWORD);
        assert.equal(res.status, 200);

        const row = await prisma.user.findUnique({ where: { id: u.userId } });
        assert.ok(row.deletedAt instanceof Date);
        assert.equal(row.username, `deleted:${u.userId}`);
        assert.doesNotMatch(row.passwordHash, /^\$2/, 'no bcrypt hash may remain');

        assert.equal(await prisma.userSettings.count({ where: { userId: u.userId } }), 0);
        assert.equal(await prisma.session.count({ where: { userId: u.userId } }), 0);
        assert.equal(await prisma.publicKey.count({ where: { userId: u.userId } }), 1);
        assert.equal(await prisma.signatureLog.count({ where: { userId: u.userId } }), 1);
    });

    it('logs out every session, including other devices', async () => {
        const u = await userWithHistory('del');
        await sendDelete(u.client, PASSWORD);
        assert.equal((await u.client.get('/api/auth/me')).status, 401);
        assert.equal((await u.otherDevice.get('/api/auth/me')).status, 401);
        assert.equal((await u.otherDevice.get('/api/settings')).status, 401);
    });

    it('the old credentials no longer log in, and the placeholder name cannot be used', async () => {
        const u = await userWithHistory('del');
        await sendDelete(u.client, PASSWORD);
        assert.equal((await client().post('/api/auth/login', { username: u.username, password: PASSWORD })).status, 401);
        assert.equal((await client().post('/api/auth/login', { username: `deleted:${u.userId}`, password: PASSWORD })).status, 401);
        assert.equal((await client().post('/api/auth/register', { username: `deleted:${u.userId}`, password: PASSWORD })).status, 400);
    });

    it('the freed username can be registered again without inheriting anything', async () => {
        const u = await userWithHistory('del');
        await sendDelete(u.client, PASSWORD);

        const newcomer = client();
        assert.equal((await newcomer.post('/api/auth/register', { username: u.username, password: PASSWORD })).status, 200);
        assert.deepEqual((await newcomer.get('/api/keys/mine')).body.keys, []);
        assert.deepEqual((await newcomer.get('/api/signatures/mine')).body.entries, []);

        const lookup = await newcomer.get(`/api/keys/by-username/${u.username}`);
        assert.deepEqual(lookup.body.keys, [], 'old keys must not be attributed to the new owner of the name');
    });

    it('past signatures stay verifiable and show the signer as deleted', async () => {
        const u = await userWithHistory('del');
        await sendDelete(u.client, PASSWORD);
        const { client: verifier } = await registeredClient('verifier');

        const byFp = await verifier.get(`/api/keys/by-fingerprint/${u.key.fingerprint}`);
        assert.equal(byFp.status, 200);
        assert.equal(byFp.body.key.publicKeyPem, u.key.pem);
        assert.deepEqual(byFp.body.key.user, { username: null, accountDeleted: true });

        const byHash = await verifier.get(`/api/signatures/by-hash/${u.hash}`);
        assert.equal(byHash.body.entries.length, 1);
        assert.equal(byHash.body.entries[0].username, null);
        assert.equal(byHash.body.entries[0].accountDeleted, true);
        assert.equal(byHash.body.entries[0].publicKeyFingerprint, u.key.fingerprint);
        assert.ok(!JSON.stringify(byHash.body).includes('deleted:'), 'placeholder name must not leak');
    });

    it('the placeholder name is not a working username lookup', async () => {
        const u = await userWithHistory('del');
        await sendDelete(u.client, PASSWORD);
        const { client: verifier } = await registeredClient('verifier');

        const res = await verifier.get(`/api/keys/by-username/deleted:${u.userId}`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { keys: [] }, 'must look exactly like an unknown username');
    });

    it('a deleted user\'s key cannot be claimed by someone else', async () => {
        const u = await userWithHistory('del');
        await sendDelete(u.client, PASSWORD);
        const { client: other } = await registeredClient('claim');
        const res = await other.post('/api/keys', { label: 'mine now', publicKeyPem: u.key.pem });
        assert.equal(res.status, 409);
    });

    it('live accounts show accountDeleted: false in lookups', async () => {
        const u = await userWithHistory('live');
        const { client: verifier } = await registeredClient('verifier');
        const byFp = await verifier.get(`/api/keys/by-fingerprint/${u.key.fingerprint}`);
        assert.deepEqual(byFp.body.key.user, { username: u.username, accountDeleted: false });
    });
});

function sendDelete(c, currentPassword) {
    return c.delete('/api/auth/account', { currentPassword });
}
