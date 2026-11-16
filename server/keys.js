// keys.js - Server-side storage of public keys.
// Private keys never reach the server — this only handles the public half.
const express = require('express');
const crypto = require('crypto');
const { prisma, publicOwner } = require('./userStore');
const { requireAuth } = require('./middleware');
const { validate, LIMITS } = require('./validators');

const router = express.Router();

// SHA-256 fingerprint of the DER-encoded SubjectPublicKeyInfo (standard X.509 fingerprint).
function fingerprintFromPem(pem) {
    const keyObject = crypto.createPublicKey(pem);
    const der = keyObject.export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest('hex');
}

// Only keys the app can use, and that are strong enough, may be registered: RSA of at
// least 2048 bits with the standard public exponent, or ECDSA on a curve every browser
// supports. Anything else could never verify in the app or would be weak.
const MIN_RSA_BITS = 2048;
const ALLOWED_CURVES = new Set(['prime256v1', 'secp384r1', 'secp521r1']); // P-256, P-384, P-521

function keyPolicyError(pem) {
    const key = crypto.createPublicKey(pem);
    const details = key.asymmetricKeyDetails || {};
    if (key.asymmetricKeyType === 'rsa') {
        if (details.modulusLength < MIN_RSA_BITS) return `RSA keys must be at least ${MIN_RSA_BITS} bits`;
        if (details.publicExponent !== 65537n) return 'RSA keys must use the standard public exponent 65537';
        return null;
    }
    if (key.asymmetricKeyType === 'ec') {
        if (!ALLOWED_CURVES.has(details.namedCurve)) return 'ECDSA keys must use the P-256, P-384 or P-521 curve';
        return null;
    }
    return 'Only RSA and ECDSA public keys are supported';
}

router.post('/', requireAuth, async (req, res) => {
    try {
        const { label, publicKeyPem } = req.body;
        const err = validate({ label, publicKeyPem });
        if (err) return res.status(400).json({ error: err });

        let fingerprint;
        try {
            fingerprint = fingerprintFromPem(publicKeyPem);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid PEM-encoded public key' });
        }
        const policyErr = keyPolicyError(publicKeyPem);
        if (policyErr) return res.status(400).json({ error: policyErr });

        const existing = await prisma.publicKey.findUnique({ where: { fingerprint } });
        if (existing) {
            if (existing.userId !== req.session.user.id) {
                return res.status(409).json({ error: 'This public key is already registered to another user' });
            }
            return res.json({ key: existing, alreadyExisted: true });
        }

        const key = await prisma.publicKey.create({
            data: {
                userId: req.session.user.id,
                fingerprint,
                publicKeyPem,
                label: label.trim(),
            },
        });
        res.status(201).json({ key });
    } catch (err) {
        console.error('Key POST error:', err);
        res.status(500).json({ error: 'Failed to save public key' });
    }
});

router.get('/mine', requireAuth, async (req, res) => {
    try {
        const keys = await prisma.publicKey.findMany({
            where: { userId: req.session.user.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true, fingerprint: true, label: true, createdAt: true, publicKeyPem: true },
        });
        res.json({ keys });
    } catch (err) {
        console.error('Key list error:', err);
        res.status(500).json({ error: 'Failed to load keys' });
    }
});

// Exact-username lookup. Returns the user's public keys; empty list if no such user
// (we don't 404 here, to avoid leaking which usernames exist). Deleted accounts look
// the same as unknown ones; their keys stay reachable by fingerprint for verification.
router.get('/by-username/:username', requireAuth, async (req, res) => {
    try {
        const username = String(req.params.username || '').trim();
        if (!username) return res.json({ keys: [] });
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user || user.deletedAt) return res.json({ keys: [] });
        const keys = await prisma.publicKey.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true, fingerprint: true, label: true, createdAt: true, publicKeyPem: true },
        });
        res.json({ username: user.username, keys });
    } catch (err) {
        console.error('Key by-username error:', err);
        res.status(500).json({ error: 'Lookup failed' });
    }
});

router.get('/by-fingerprint/:fingerprint', requireAuth, async (req, res) => {
    try {
        const fingerprint = String(req.params.fingerprint || '').trim().toLowerCase();
        if (!fingerprint) return res.status(404).json({ error: 'No key with that fingerprint' });
        const key = await prisma.publicKey.findUnique({
            where: { fingerprint },
            select: {
                id: true, fingerprint: true, label: true, createdAt: true, publicKeyPem: true,
                user: { select: { username: true, deletedAt: true } },
            },
        });
        if (!key) return res.status(404).json({ error: 'No key with that fingerprint' });
        // Keys of deleted accounts stay findable so their past signatures can be verified.
        res.json({ key: { ...key, user: publicOwner(key.user) } });
    } catch (err) {
        console.error('Key by-fingerprint error:', err);
        res.status(500).json({ error: 'Lookup failed' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

        const key = await prisma.publicKey.findUnique({ where: { id } });
        if (!key || key.userId !== req.session.user.id) {
            return res.status(404).json({ error: 'Key not found' });
        }
        await prisma.publicKey.delete({ where: { id } });
        res.json({ success: true });
    } catch (err) {
        console.error('Key DELETE error:', err);
        // Foreign-key violation: key is referenced by signature_log
        if (err && err.code === 'P2003') {
            return res.status(409).json({ error: 'Cannot delete: key is referenced by signature log entries' });
        }
        res.status(500).json({ error: 'Failed to delete key' });
    }
});

module.exports = { router, fingerprintFromPem };
