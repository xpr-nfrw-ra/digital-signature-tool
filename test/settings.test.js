const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, registeredClient, registerKey, cleanup } = require('./helpers');

after(cleanup);

describe('settings', () => {
    it('returns defaults for a new user', async () => {
        const { client: c } = await registeredClient('set');
        const res = await c.get('/api/settings');
        assert.equal(res.status, 200);
        assert.equal(res.body.settings.hashAlgorithm, 'sha256');
        assert.equal(res.body.settings.signatureAlgorithm, 'rsa');
        assert.equal(res.body.settings.keySize, 2048);
        assert.equal(res.body.settings.defaultPublicKeyId, null);
    });

    it('saves valid changes', async () => {
        const { client: c } = await registeredClient('set');
        const res = await c.put('/api/settings', { hashAlgorithm: 'sha512', keySize: '4096' });
        assert.equal(res.status, 200);
        assert.equal(res.body.settings.hashAlgorithm, 'sha512');
        assert.equal(res.body.settings.keySize, 4096);
        assert.equal((await c.get('/api/settings')).body.settings.hashAlgorithm, 'sha512');
    });

    it('rejects values outside the allowed sets', async () => {
        const { client: c } = await registeredClient('set');
        for (const body of [
            { hashAlgorithm: 'md5' },
            { hashAlgorithm: 'sha3-256' },
            { signatureAlgorithm: 'dsa' },
            { keySize: 1024 },
            { defaultPublicKeyId: 'abc' },
        ]) {
            assert.equal((await c.put('/api/settings', body)).status, 400, JSON.stringify(body));
        }
    });

    it('accepts only the caller\'s own key as default', async () => {
        const { client: alice } = await registeredClient('alice');
        const { client: bob } = await registeredClient('bob');
        const aliceKey = await registerKey(alice);
        const bobKey = await registerKey(bob);

        assert.equal((await alice.put('/api/settings', { defaultPublicKeyId: bobKey.id })).status, 400);
        const ok = await alice.put('/api/settings', { defaultPublicKeyId: aliceKey.id });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.settings.defaultPublicKeyId, aliceKey.id);

        const cleared = await alice.put('/api/settings', { defaultPublicKeyId: null });
        assert.equal(cleared.body.settings.defaultPublicKeyId, null);
    });

    it('clears the default when that key is deleted (ON DELETE SET NULL)', async () => {
        const { client: c, userId } = await registeredClient('set');
        const key = await registerKey(c);
        await c.put('/api/settings', { defaultPublicKeyId: key.id });

        assert.equal((await c.delete(`/api/keys/${key.id}`)).status, 200);
        const settings = await prisma.userSettings.findUnique({ where: { userId } });
        assert.equal(settings.defaultPublicKeyId, null);
    });
});
