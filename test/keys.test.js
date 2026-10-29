const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
    prisma, client, registeredClient, uniqueUsername, newPublicKeyPem, registerKey, sha256Hex, cleanup,
} = require('./helpers');

after(cleanup);

describe('authentication gate', () => {
    it('every keys/settings/signatures route returns 401 without a session', async () => {
        const c = client();
        const fp = 'a'.repeat(64);
        const calls = [
            () => c.post('/api/keys', { label: 'x', publicKeyPem: 'x' }),
            () => c.get('/api/keys/mine'),
            () => c.get('/api/keys/by-username/someone'),
            () => c.get(`/api/keys/by-fingerprint/${fp}`),
            () => c.delete('/api/keys/1'),
            () => c.get('/api/settings'),
            () => c.put('/api/settings', { hashAlgorithm: 'sha256' }),
            () => c.post('/api/signatures', { documentName: 'a', documentHash: fp, publicKeyFingerprint: fp }),
            () => c.get('/api/signatures/mine'),
        ];
        for (const call of calls) {
            assert.equal((await call()).status, 401);
        }
    });
});

describe('register public key', () => {
    it('stores the key with a server-computed SHA-256 SPKI fingerprint', async () => {
        const { client: c, userId } = await registeredClient('key');
        const { pem, fingerprint } = newPublicKeyPem();
        const res = await c.post('/api/keys', { label: '  Work key  ', publicKeyPem: pem });
        assert.equal(res.status, 201);
        assert.equal(res.body.key.fingerprint, fingerprint);
        assert.equal(res.body.key.label, 'Work key');
        assert.equal(res.body.key.userId, userId);
    });

    it('is idempotent for the same user', async () => {
        const { client: c } = await registeredClient('key');
        const { pem } = newPublicKeyPem();
        const first = await c.post('/api/keys', { label: 'k', publicKeyPem: pem });
        const second = await c.post('/api/keys', { label: 'k', publicKeyPem: pem });
        assert.equal(second.status, 200);
        assert.equal(second.body.alreadyExisted, true);
        assert.equal(second.body.key.id, first.body.key.id);
    });

    it('refuses a key already registered to another user', async () => {
        const { client: alice } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const { pem } = newPublicKeyPem();
        await alice.post('/api/keys', { label: 'k', publicKeyPem: pem });
        const res = await bob.post('/api/keys', { label: 'k', publicKeyPem: pem });
        assert.equal(res.status, 409);
    });

    it('rejects malformed input', async () => {
        const { client: c } = await registeredClient('key');
        const { pem } = newPublicKeyPem();
        const broken = pem.replace(/[A-Za-z0-9+/]{20}/, 'A'.repeat(20)); // right shape, corrupt DER
        for (const body of [
            { label: '', publicKeyPem: pem },
            { label: 'x'.repeat(65), publicKeyPem: pem },
            { label: 'k', publicKeyPem: 'not a pem at all, but long enough to pass the length check '.repeat(3) },
            { label: 'k', publicKeyPem: broken },
        ]) {
            assert.equal((await c.post('/api/keys', body)).status, 400);
        }
    });
});

describe('look up public keys', () => {
    it('mine returns only the caller\'s keys', async () => {
        const { client: alice } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const a = await registerKey(alice);
        await registerKey(bob);
        const res = await alice.get('/api/keys/mine');
        assert.deepEqual(res.body.keys.map(k => k.id), [a.id]);
    });

    it('by-username returns all of that user\'s keys, and an empty list for unknown users', async () => {
        const { client: alice, username } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const k1 = await registerKey(alice, 'one');
        const k2 = await registerKey(alice, 'two');

        const res = await bob.get(`/api/keys/by-username/${username}`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.keys.map(k => k.id).sort(), [k1.id, k2.id].sort());

        const unknown = await bob.get(`/api/keys/by-username/${uniqueUsername('ghost')}`);
        assert.equal(unknown.status, 200, 'must not reveal which usernames exist');
        assert.deepEqual(unknown.body.keys, []);
    });

    it('by-fingerprint finds the key (case-insensitive) with its owner, 404 otherwise', async () => {
        const { client: alice, username } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const key = await registerKey(alice);

        const res = await bob.get(`/api/keys/by-fingerprint/${key.fingerprint.toUpperCase()}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.key.id, key.id);
        assert.equal(res.body.key.user.username, username);

        assert.equal((await bob.get(`/api/keys/by-fingerprint/${'0'.repeat(64)}`)).status, 404);
    });
});

describe('delete public key', () => {
    it('deletes the caller\'s own key', async () => {
        const { client: c } = await registeredClient('del');
        const key = await registerKey(c);
        assert.equal((await c.delete(`/api/keys/${key.id}`)).status, 200);
        assert.equal(await prisma.publicKey.count({ where: { id: key.id } }), 0);
    });

    it('returns 404 for another user\'s key and leaves it alone', async () => {
        const { client: alice } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const key = await registerKey(alice);
        assert.equal((await bob.delete(`/api/keys/${key.id}`)).status, 404);
        assert.equal(await prisma.publicKey.count({ where: { id: key.id } }), 1);
    });

    it('returns 400 for a non-numeric id', async () => {
        const { client: c } = await registeredClient('del');
        assert.equal((await c.delete('/api/keys/abc')).status, 400);
    });

    it('refuses with 409 when the key is referenced by the signature log', async () => {
        const { client: c } = await registeredClient('del');
        const key = await registerKey(c);
        await c.post('/api/signatures', {
            documentName: 'contract.pdf', documentHash: sha256Hex('doc'), publicKeyFingerprint: key.fingerprint,
        });
        assert.equal((await c.delete(`/api/keys/${key.id}`)).status, 409);
        assert.equal(await prisma.publicKey.count({ where: { id: key.id } }), 1);
    });
});
