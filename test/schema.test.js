// Database-level rules from prisma/schema.prisma, checked against the real SQLite file.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, registeredClient, registerKey, sha256Hex, cleanup } = require('./helpers');

after(cleanup);

async function logSignature(c, key) {
    const res = await c.post('/api/signatures', {
        documentName: 'doc.txt', documentHash: sha256Hex(String(Math.random())), publicKeyFingerprint: key.fingerprint,
    });
    assert.equal(res.status, 201);
}

describe('on-delete rules', () => {
    it('deleting a user with no keys or history cascades to sessions and settings', async () => {
        const { userId } = await registeredClient('cascade');
        assert.equal(await prisma.session.count({ where: { userId } }), 1);

        await prisma.user.delete({ where: { id: userId } });
        assert.equal(await prisma.session.count({ where: { userId } }), 0);
        assert.equal(await prisma.userSettings.count({ where: { userId } }), 0);
    });

    it('a user who owns public keys cannot be deleted (RESTRICT)', async () => {
        const { client: c, userId } = await registeredClient('restrict');
        await registerKey(c);
        await assert.rejects(prisma.user.delete({ where: { id: userId } }));
        assert.equal(await prisma.user.count({ where: { id: userId } }), 1);
    });

    it('a public key referenced by the signature log cannot be deleted (RESTRICT)', async () => {
        const { client: c } = await registeredClient('restrict');
        const key = await registerKey(c);
        await logSignature(c, key);
        await assert.rejects(prisma.publicKey.delete({ where: { id: key.id } }));
    });

    it('a user with signing history cannot be deleted (RESTRICT keeps the audit trail)', async () => {
        const { client: c, userId } = await registeredClient('restrict');
        const key = await registerKey(c);
        await logSignature(c, key);
        await assert.rejects(prisma.user.delete({ where: { id: userId } }));
        assert.equal(await prisma.signatureLog.count({ where: { userId } }), 1);
    });
});

describe('uniqueness', () => {
    it('usernames and fingerprints are unique', async () => {
        const { username, client: c } = await registeredClient('uniq');
        await assert.rejects(prisma.user.create({ data: { username, passwordHash: 'x' } }));

        const key = await registerKey(c);
        const other = await registeredClient('uniq');
        await assert.rejects(prisma.publicKey.create({
            data: { userId: other.userId, fingerprint: key.fingerprint, publicKeyPem: key.pem, label: 'dup' },
        }));
    });
});
