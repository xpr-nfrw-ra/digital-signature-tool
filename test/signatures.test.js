const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, client, registeredClient, registerKey, sha256Hex, cleanup } = require('./helpers');

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
        assert.equal(res.body.nextCursor, null);
    });

    it('pages through history with limit and cursor, without gaps or repeats', async () => {
        const { client: c } = await registeredClient('page');
        const key = await registerKey(c);
        for (let i = 1; i <= 7; i++) {
            await c.post('/api/signatures', {
                documentName: `doc${i}.txt`, documentHash: sha256Hex(`doc${i}`), publicKeyFingerprint: key.fingerprint,
            });
        }

        const seen = [];
        let url = '/api/signatures/mine?limit=3';
        for (let pages = 0; pages < 10; pages++) {
            const res = await c.get(url);
            assert.equal(res.status, 200);
            assert.ok(res.body.entries.length <= 3);
            seen.push(...res.body.entries.map(e => e.documentName));
            if (res.body.nextCursor === null) break;
            url = `/api/signatures/mine?limit=3&cursor=${res.body.nextCursor}`;
        }
        assert.deepEqual(seen, ['doc7.txt', 'doc6.txt', 'doc5.txt', 'doc4.txt', 'doc3.txt', 'doc2.txt', 'doc1.txt']);
    });

    it('a new entry arriving between pages does not shift later pages', async () => {
        const { client: c } = await registeredClient('page');
        const key = await registerKey(c);
        const sign = name => c.post('/api/signatures', {
            documentName: name, documentHash: sha256Hex(name), publicKeyFingerprint: key.fingerprint,
        });
        for (const name of ['a.txt', 'b.txt', 'c.txt']) await sign(name);

        const first = await c.get('/api/signatures/mine?limit=2');
        await sign('new.txt');
        const second = await c.get(`/api/signatures/mine?limit=2&cursor=${first.body.nextCursor}`);
        assert.deepEqual(second.body.entries.map(e => e.documentName), ['a.txt']);
    });

    it('rejects invalid limit and cursor values', async () => {
        const { client: c } = await registeredClient('page');
        for (const qs of ['limit=0', 'limit=101', 'limit=abc', 'limit=2.5', 'cursor=0', 'cursor=-3', 'cursor=x']) {
            assert.equal((await c.get(`/api/signatures/mine?${qs}`)).status, 400, qs);
        }
    });
});

describe('look up signing events by document hash', () => {
    it('returns every signer of the document, without document names', async () => {
        const { client: alice, username: aliceName } = await registeredClient('alice');
        const { client: bob, username: bobName } = await registeredClient('bob');
        const { client: carol } = await registeredClient('carol');
        const aliceKey = await registerKey(alice);
        const bobKey = await registerKey(bob);
        const hash = sha256Hex('shared contract');

        await alice.post('/api/signatures', { documentName: 'secret-deal.pdf', documentHash: hash, publicKeyFingerprint: aliceKey.fingerprint });
        await bob.post('/api/signatures', { documentName: 'contract.pdf', documentHash: hash, publicKeyFingerprint: bobKey.fingerprint });
        await bob.post('/api/signatures', { documentName: 'other.pdf', documentHash: sha256Hex('other'), publicKeyFingerprint: bobKey.fingerprint });

        const res = await carol.get(`/api/signatures/by-hash/${hash.toUpperCase()}`);
        assert.equal(res.status, 200);
        assert.deepEqual(
            res.body.entries.map(e => [e.username, e.publicKeyFingerprint]),
            [[bobName, bobKey.fingerprint], [aliceName, aliceKey.fingerprint]],
        );
        assert.ok(res.body.entries.every(e => e.signedAt && !('documentName' in e)));
        assert.ok(!JSON.stringify(res.body).includes('secret-deal'), 'document names must not leak');
        assert.equal(res.body.nextCursor, null);
    });

    it('returns an empty list for a document nobody signed', async () => {
        const { client: c } = await registeredClient('hash');
        const res = await c.get(`/api/signatures/by-hash/${sha256Hex('never signed')}`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.entries, []);
    });

    it('paginates like /mine', async () => {
        const { client: c } = await registeredClient('hash');
        const key = await registerKey(c);
        const hash = sha256Hex('signed often');
        for (let i = 0; i < 3; i++) {
            await c.post('/api/signatures', { documentName: 'x.txt', documentHash: hash, publicKeyFingerprint: key.fingerprint });
        }
        const first = await c.get(`/api/signatures/by-hash/${hash}?limit=2`);
        assert.equal(first.body.entries.length, 2);
        const second = await c.get(`/api/signatures/by-hash/${hash}?limit=2&cursor=${first.body.nextCursor}`);
        assert.equal(second.body.entries.length, 1);
        assert.equal(second.body.nextCursor, null);
    });

    it('rejects malformed hashes and requires a session', async () => {
        const { client: c } = await registeredClient('hash');
        for (const bad of ['abc', 'z'.repeat(64), 'a'.repeat(65)]) {
            assert.equal((await c.get(`/api/signatures/by-hash/${bad}`)).status, 400, bad);
        }
        assert.equal((await client().get(`/api/signatures/by-hash/${sha256Hex('x')}`)).status, 401);
    });
});
