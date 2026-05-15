// sessionStore.js - express-session Store backed by Prisma `Session` model.
// Sessions survive server restarts. Expired rows are deleted on startup and on access.

const session = require('express-session');
const { prisma } = require('./userStore');

const Store = session.Store;

class PrismaSessionStore extends Store {
    constructor({ defaultMaxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
        super();
        this.defaultMaxAgeMs = defaultMaxAgeMs;
    }

    _expiresAt(sess) {
        if (sess && sess.cookie && sess.cookie.expires) {
            return new Date(sess.cookie.expires);
        }
        return new Date(Date.now() + this.defaultMaxAgeMs);
    }

    async get(sid, cb) {
        try {
            const row = await prisma.session.findUnique({ where: { id: sid } });
            if (!row) return cb(null, null);
            if (row.expiresAt.getTime() <= Date.now()) {
                await prisma.session.delete({ where: { id: sid } }).catch(() => {});
                return cb(null, null);
            }
            cb(null, JSON.parse(row.sessionData));
        } catch (err) {
            cb(err);
        }
    }

    async set(sid, sess, cb) {
        try {
            const data = JSON.stringify(sess);
            const expiresAt = this._expiresAt(sess);
            const userId = sess && sess.user && Number.isInteger(sess.user.id) ? sess.user.id : null;
            await prisma.session.upsert({
                where: { id: sid },
                create: { id: sid, sessionData: data, expiresAt, userId },
                update: { sessionData: data, expiresAt, userId },
            });
            cb(null);
        } catch (err) {
            cb(err);
        }
    }

    async destroy(sid, cb) {
        try {
            await prisma.session.delete({ where: { id: sid } }).catch(() => {});
            cb(null);
        } catch (err) {
            cb(err);
        }
    }

    async touch(sid, sess, cb) {
        try {
            await prisma.session.update({
                where: { id: sid },
                data: { expiresAt: this._expiresAt(sess) },
            }).catch(() => {});
            cb(null);
        } catch (err) {
            cb(err);
        }
    }
}

async function cleanupExpiredSessions() {
    const result = await prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
}

module.exports = { PrismaSessionStore, cleanupExpiredSessions };
