// setup.js - First-time setup: `npm run setup` (or double-click setup.bat).
// Safe to run again: every step skips work that is already done.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const SERVER_CERT = path.join(ROOT, 'certs', 'server.crt');

function step(n, title) {
    console.log(`\n=== [${n}/4] ${title} ===`);
}

function fail(message) {
    console.error(`\nSetup failed: ${message}`);
    process.exit(1);
}

// Commands are fixed strings (no user input); a shell is needed to find npm/npx on Windows.
function run(command, what) {
    const result = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
    if (result.status !== 0) fail(`${what} did not succeed (see the messages above).`);
}

function checkNodeVersion() {
    const [major, minor] = process.versions.node.split('.').map(Number);
    const ok = major >= 24 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
    if (!ok) fail(`Node.js ${process.versions.node} is too old. Install Node.js 22 LTS or newer from https://nodejs.org/`);
}

function hasBash() {
    return spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;
}

checkNodeVersion();

step(1, 'Installing dependencies');
run('npm install', 'npm install');

step(2, 'Creating .env');
if (fs.existsSync(ENV_FILE)) {
    console.log('.env already exists - leaving it untouched.');
} else {
    const template = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(ENV_FILE, template.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`));
    console.log('Created .env with a random SESSION_SECRET.');
}

step(3, 'Creating / updating the database');
run('npx prisma migrate deploy', 'Database setup');

step(4, 'Creating the HTTPS certificates');
if (fs.existsSync(SERVER_CERT)) {
    console.log('certs/ already exists - leaving it untouched. (Delete the certs folder to create new ones.)');
} else {
    if (!hasBash()) fail('"bash" was not found. Install Git for Windows (https://git-scm.com/), then open a new terminal and run setup again.');
    run('bash scripts/gen-ca-chain.sh', 'Certificate generation');
}

console.log(`
Setup complete.

Next:
  1. Trust the certificate once, so your browser shows no warning
     (see "Trust the certificate" in README.md).
  2. Start the app:   npm run dev      (or double-click start.bat)
  3. Open:            https://localhost:3443
`);
