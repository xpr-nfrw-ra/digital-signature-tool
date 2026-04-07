// userStore.js - Prisma/SQLite user storage
// All functions are async so the interface stays identical to the old JSON-based store.

const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbPath = path.join(__dirname, '..', 'dev.db');
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

async function initialize() {
    await prisma.$connect();
}

module.exports = { findUserByUsername, createUser, initialize, prisma };
