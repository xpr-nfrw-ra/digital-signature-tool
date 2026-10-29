// helpers.js - Shared test setup. Require this BEFORE anything from server/:
// it points DATABASE_URL at a private copy of the template DB for this test file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');

const templatePath = path.join(__dirname, '.tmp', 'template.db');
if (!fs.existsSync(templatePath)) {
    throw new Error('Test template DB missing. Run tests with `npm test`, which builds it first.');
}
const dbPath = path.join(os.tmpdir(), `signtool-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
fs.copyFileSync(templatePath, dbPath);

process.env.DATABASE_URL = 'file:' + dbPath;
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');

const { app } = require('../server/app');
const { prisma } = require('../server/userStore');
const { fingerprintFromPem } = require('../server/keys');

// Supertest connects over plain HTTP from loopback. Trusting loopback proxies lets tests
// mark requests as HTTPS (X-Forwarded-Proto) so the Secure session cookie is issued,
// and give each client its own IP (X-Forwarded-For) so rate-limit counters don't leak
// between tests. Production never sets this.
app.set('trust proxy', 'loopback');

const PASSWORD = 'Test-pass-123!';
let counter = 0;

function uniqueIp() {
    counter++;
    return `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;
}

function uniqueUsername(prefix = 'user') {
    counter++;
    return `${prefix}_${process.pid}_${counter}`;
}

// A minimal browser: remembers the session cookie itself, because supertest's cookie jar
// won't send a Secure cookie back over plain HTTP.
function client({ ip = uniqueIp() } = {}) {
    let cookie = null;

    async function send(method, url, body) {
        let req = request(app)[method](url)
            .set('X-Forwarded-Proto', 'https')
            .set('X-Forwarded-For', ip);
        if (cookie) req = req.set('Cookie', cookie);
        if (body !== undefined) req = req.send(body);
        const res = await req;
        const sid = (res.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
        if (sid) cookie = sid.split(';')[0];
        return res;
    }

    return {
        get: url => send('get', url),
        post: (url, body) => send('post', url, body),
        put: (url, body) => send('put', url, body),
        delete: url => send('delete', url),
        get cookie() { return cookie; },
        set cookie(value) { cookie = value; },
    };
}

// Registers a fresh user and returns a client logged in as them.
async function registeredClient(prefix) {
    const c = client();
    const username = uniqueUsername(prefix);
    const res = await c.post('/api/auth/register', { username, password: PASSWORD });
    if (res.status !== 200) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    const user = await prisma.user.findUnique({ where: { username } });
    return { client: c, username, password: PASSWORD, userId: user.id };
}

function newPublicKeyPem() {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    return { pem, fingerprint: fingerprintFromPem(pem) };
}

// Registers a new public key for the client and returns { id, pem, fingerprint }.
async function registerKey(c, label = 'Test key') {
    const { pem, fingerprint } = newPublicKeyPem();
    const res = await c.post('/api/keys', { label, publicKeyPem: pem });
    if (res.status !== 201) throw new Error(`key register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { id: res.body.key.id, pem, fingerprint };
}

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

async function cleanup() {
    await prisma.$disconnect();
    fs.rmSync(dbPath, { force: true });
}

module.exports = {
    app, prisma, PASSWORD,
    client, registeredClient, uniqueUsername, uniqueIp,
    newPublicKeyPem, registerKey, sha256Hex, cleanup,
};
