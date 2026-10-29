// userStore.js - Prisma/SQLite user storage
// All functions are async so the interface stays identical to the old JSON-based store.

const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

// DATABASE_URL is shared with the Prisma CLI (prisma.config.ts). A relative path is resolved
// against the project root so the server finds the same file regardless of the working directory.
const PROJECT_ROOT = path.join(__dirname, '..');
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const dbPath = path.resolve(PROJECT_ROOT, dbUrl.replace(/^file:/, ''));
const adapter = new PrismaBetterSqlite3({ url: 'file:' + dbPath });
const prisma = new PrismaClient({ adapter });

async function findUserByUsername(username) {
    return prisma.user.findUnique({ where: { username } });
}

async function createUser(username, hashedPassword) {
    return prisma.user.create({
        data: {
            username,
            passwordHash: hashedPassword,
        },
    });
}

// How a user appears in other people's lookups. A deleted account's internal
// placeholder name (deleted:<id>) is never shown — just the fact that it was deleted.
function publicOwner(user) {
    return user.deletedAt
        ? { username: null, accountDeleted: true }
        : { username: user.username, accountDeleted: false };
}

async function initialize() {
    await prisma.$connect();
}

module.exports = { findUserByUsername, createUser, publicOwner, initialize, prisma };
