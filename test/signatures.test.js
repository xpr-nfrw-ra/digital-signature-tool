const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, registeredClient, registerKey, sha256Hex, cleanup } = require('./helpers');

after(cleanup);

describe('log a signing event', () => {
    it('records the event against the caller\'s key, normalising the hash to lowercase', async () => {
        const { client: c, userId } = await registeredClient('sig');
        const key = await registerKey(c);
        const hash = sha256Hex('contract').toUpperCase();
        const res = await c.post('/api/signatures', {
            documentName: ' contract.pdf ', documentHash: hash, publicKeyFingerprint: key.fingerprint,
        });
        assert.equal(res.status, 201);
        assert.equal(res.body.entry.userId, userId);
        assert.equal(res.body.entry.publicKeyId, key.id);
        assert.equal(res.body.entry.documentName, 'contract.pdf');
        assert.equal(res.body.entry.documentHash, hash.toLowerCase());
    });

    it('refuses another user\'s key with 403', async () => {
        const { client: alice } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const aliceKey = await registerKey(alice);
        const res = await bob.post('/api/signatures', {
            documentName: 'x.txt', documentHash: sha256Hex('x'), publicKeyFingerprint: aliceKey.fingerprint,
        });
        assert.equal(res.status, 403);
        assert.equal(await prisma.signatureLog.count({ where: { publicKeyId: aliceKey.id } }), 0);
    });

    it('refuses an unregistered key with 400', async () => {
        const { client: c } = await registeredClient('sig');
        const res = await c.post('/api/signatures', {
            documentName: 'x.txt', documentHash: sha256Hex('x'), publicKeyFingerprint: 'b'.repeat(64),
        });
        assert.equal(res.status, 400);
    });

    it('rejects malformed fields', async () => {
        const { client: c } = await registeredClient('sig');
        const key = await registerKey(c);
        const good = { documentName: 'x.txt', documentHash: sha256Hex('x'), publicKeyFingerprint: key.fingerprint };
        for (const patch of [
            { documentName: '' },
            { documentName: '../etc/passwd' },
            { documentName: 'a\\b.txt' },
            { documentName: 'line\nbreak.txt' },
            { documentName: 'x'.repeat(256) },
            { documentHash: 'abc' },
            { documentHash: 'z'.repeat(64) },
            { documentHash: 'a'.repeat(65) },
            { publicKeyFingerprint: 'a'.repeat(63) },
        ]) {
            const res = await c.post('/api/signatures', { ...good, ...patch });
            assert.equal(res.status, 400, JSON.stringify(patch));
        }
    });

    it('accepts SHA-384 and SHA-512 length hashes', async () => {
        const { client: c } = await registeredClient('sig');
        const key = await registerKey(c);
        for (const len of [96, 128]) {
            const res = await c.post('/api/signatures', {
                documentName: 'x.txt', documentHash: 'a'.repeat(len), publicKeyFingerprint: key.fingerprint,
            });
            assert.equal(res.status, 201);
        }
    });
});

describe('signing history', () => {
    it('returns only the caller\'s entries, newest first, with key label and fingerprint', async () => {
        const { client: alice } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const aliceKey = await registerKey(alice, 'Alice key');
        const bobKey = await registerKey(bob);

        for (const name of ['first.txt', 'second.txt']) {
            await alice.post('/api/signatures', {
                documentName: name, documentHash: sha256Hex(name), publicKeyFingerprint: aliceKey.fingerprint,
            });
        }
        await bob.post('/api/signatures', {
            documentName: 'bob.txt', documentHash: sha256Hex('bob'), publicKeyFingerprint: bobKey.fingerprint,
        });

        const res = await alice.get('/api/signatures/mine');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.entries.map(e => e.documentName).sort(), ['first.txt', 'second.txt']);
        const times = res.body.entries.map(e => new Date(e.signedAt).getTime());
        assert.ok(times[0] >= times[1], 'newest first');
        assert.deepEqual(res.body.entries[0].publicKey, { fingerprint: aliceKey.fingerprint, label: 'Alice key' });
    });
});
