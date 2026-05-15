// settings.js - Per-user crypto/UI preferences
const express = require('express');
const { prisma } = require('./userStore');
const { requireAuth } = require('./middleware');

const router = express.Router();

// SHA-3 will be added in a later phase once a crypto lib that supports it is in place.
const ALLOWED_HASH = new Set(['sha256', 'sha384', 'sha512']);
const ALLOWED_SIG  = new Set(['rsa', 'ecdsa']);
const ALLOWED_KEY_SIZES = new Set([2048, 3072, 4096]);

const DEFAULTS = {
    hashAlgorithm: 'sha256',
    signatureAlgorithm: 'rsa',
    keySize: 2048,
    defaultPublicKeyId: null,
};

async function ensureSettings(userId) {
    const existing = await prisma.userSettings.findUnique({ where: { userId } });
    if (existing) return existing;
    return prisma.userSettings.create({ data: { userId, ...DEFAULTS } });
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const settings = await ensureSettings(req.session.user.id);
        res.json({ settings });
    } catch (err) {
        console.error('Settings GET error:', err);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

router.put('/', requireAuth, async (req, res) => {
    try {
        const { hashAlgorithm, signatureAlgorithm, keySize, defaultPublicKeyId } = req.body;
        const data = {};

        if (hashAlgorithm !== undefined) {
            if (!ALLOWED_HASH.has(hashAlgorithm)) {
                return res.status(400).json({ error: 'Invalid hash algorithm' });
            }
            data.hashAlgorithm = hashAlgorithm;
        }
        if (signatureAlgorithm !== undefined) {
            if (!ALLOWED_SIG.has(signatureAlgorithm)) {
                return res.status(400).json({ error: 'Invalid signature algorithm' });
            }
            data.signatureAlgorithm = signatureAlgorithm;
        }
        if (keySize !== undefined) {
            const n = Number(keySize);
            if (!ALLOWED_KEY_SIZES.has(n)) {
                return res.status(400).json({ error: 'Invalid key size' });
            }
            data.keySize = n;
        }
        if (defaultPublicKeyId !== undefined) {
            if (defaultPublicKeyId === null) {
                data.defaultPublicKeyId = null;
            } else {
                const n = Number(defaultPublicKeyId);
                if (!Number.isInteger(n)) {
                    return res.status(400).json({ error: 'Invalid defaultPublicKeyId' });
                }
                const key = await prisma.publicKey.findUnique({ where: { id: n } });
                if (!key || key.userId !== req.session.user.id) {
                    return res.status(400).json({ error: 'Public key not found for this user' });
                }
                data.defaultPublicKeyId = n;
            }
        }

        await ensureSettings(req.session.user.id);
        const settings = await prisma.userSettings.update({
            where: { userId: req.session.user.id },
            data,
        });
        res.json({ settings });
    } catch (err) {
        console.error('Settings PUT error:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

module.exports = { router, ensureSettings, DEFAULTS };
