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

// Cursor pagination over signature_log ids, newest first. Ids grow with insertion
// order, so "id < cursor" is stable even when new entries arrive between pages.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parsePagination(query) {
    const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        return { error: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}` };
    }
    let cursor = null;
    if (query.cursor !== undefined) {
        cursor = Number(query.cursor);
        if (!Number.isInteger(cursor) || cursor < 1) {
            return { error: 'cursor must be a positive integer' };
        }
    }
    return { limit, cursor };
}

// Fetches one page; returns { rows, nextCursor } where nextCursor is null on the last page.
async function findPage(where, { limit, cursor }, select) {
    const rows = await prisma.signatureLog.findMany({
        where: cursor ? { ...where, id: { lt: cursor } } : where,
        orderBy: { id: 'desc' },
        take: limit + 1,
        select,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null };
}

// GET /api/signatures/mine?limit=&cursor= — the caller's own signing history.
router.get('/mine', requireAuth, async (req, res) => {
    try {
        const page = parsePagination(req.query);
        if (page.error) return res.status(400).json({ error: page.error });

        const { rows, nextCursor } = await findPage({ userId: req.session.user.id }, page, {
            id: true, documentName: true, documentHash: true, signedAt: true,
            publicKey: { select: { fingerprint: true, label: true } },
        });
        res.json({ entries: rows, nextCursor });
    } catch (err) {
        console.error('Signature log GET error:', err);
        res.status(500).json({ error: 'Failed to load signature log' });
    }
});

// GET /api/signatures/by-hash/:hash?limit=&cursor= — who signed this exact document.
// Open to any logged-in user (decision D1 in ROADMAP.md): it answers "did X sign this
// file?" for someone who already holds the file. Document names are left out, since
// they're the signer's own label and may say more than the hash does.
router.get('/by-hash/:hash', requireAuth, async (req, res) => {
    try {
        const documentHash = req.params.hash;
        const err = validate({ documentHash });
        if (err) return res.status(400).json({ error: err });

        const page = parsePagination(req.query);
        if (page.error) return res.status(400).json({ error: page.error });

        const { rows, nextCursor } = await findPage({ documentHash: documentHash.trim().toLowerCase() }, page, {
            id: true, signedAt: true,
            user: { select: { username: true } },
            publicKey: { select: { fingerprint: true } },
        });
        const entries = rows.map(r => ({
            id: r.id,
            signedAt: r.signedAt,
            username: r.user.username,
            publicKeyFingerprint: r.publicKey.fingerprint,
        }));
        res.json({ entries, nextCursor });
    } catch (err) {
        console.error('Signature log by-hash error:', err);
        res.status(500).json({ error: 'Lookup failed' });
    }
});

module.exports = { router };
