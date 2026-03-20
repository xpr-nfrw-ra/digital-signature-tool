// userStore.js - JSON file-based user storage
// All functions are async so the interface stays identical when swapping to a database.

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

async function readUsers() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function writeUsers(users) {
    await fs.writeFile(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
}

async function findUserByUsername(username) {
    const users = await readUsers();
    return users.find(u => u.username === username) || null;
}

async function createUser(username, hashedPassword) {
    const users = await readUsers();
    const user = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        username,
        hashedPassword,
        createdAt: new Date().toISOString()
    };
    users.push(user);
    await writeUsers(users);
    return user;
}

async function initialize() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
    try {
        await fs.access(DATA_FILE);
    } catch {
        await writeUsers([]);
    }
}

module.exports = { findUserByUsername, createUser, initialize };
