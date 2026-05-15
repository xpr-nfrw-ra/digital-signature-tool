// signatures.js - Signing-event audit log endpoints.
// The actual signing happens client-side; the server only records evidence.
const express = require('express');
const { prisma } = require('./userStore');
const { requireAuth } = require('./middleware');
const { validate } = require('./validators');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
    try {
        const { documentName, documentHash, publicKeyFingerprint } = req.body;
        const err = validate({ documentName, documentHash, fingerprint: publicKeyFingerprint });
        if (err) return res.status(400).json({ error: err });

        const fp = String(publicKeyFingerprint).trim().toLowerCase();
        const publicKey = await prisma.publicKey.findUnique({ where: { fingerprint: fp } });
        if (!publicKey) {
            return res.status(400).json({ error: 'Public key not registered. Generate or upload it first.' });
        }
        if (publicKey.userId !== req.session.user.id) {
            return res.status(403).json({ error: 'This key does not belong to the current user' });
        }

        const entry = await prisma.signatureLog.create({
            data: {
                userId: req.session.user.id,
                documentName: documentName.trim(),
                documentHash: documentHash.trim().toLowerCase(),
                publicKeyId: publicKey.id,
            },
        });
        res.status(201).json({ entry });
    } catch (err) {
        console.error('Signature log POST error:', err);
        res.status(500).json({ error: 'Failed to log signature' });
    }
});

router.get('/mine', requireAuth, async (req, res) => {
    try {
        const entries = await prisma.signatureLog.findMany({
            where: { userId: req.session.user.id },
            orderBy: { signedAt: 'desc' },
            include: { publicKey: { select: { fingerprint: true, label: true } } },
        });
        res.json({ entries });
    } catch (err) {
        console.error('Signature log GET error:', err);
        res.status(500).json({ error: 'Failed to load signature log' });
    }
});

module.exports = { router };
