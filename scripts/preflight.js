// preflight.js - Runs automatically before `npm start` and `npm run dev`.
// Checks that setup has been done (with a plain message if not) and applies any new
// database migrations, so starting the app after a `git pull` just works.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const at = (...p) => path.join(ROOT, ...p);

function notSetUp(what) {
    console.error(`\nThe app is not set up yet: ${what}.\nRun this first:   npm run setup      (or double-click setup.bat)\n`);
    process.exit(1);
}

if (!fs.existsSync(at('node_modules', '@prisma', 'client'))) notSetUp('dependencies are not installed');
if (!fs.existsSync(at('.env'))) notSetUp('the .env file is missing');
const env = require('dotenv').parse(fs.readFileSync(at('.env')));
if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) notSetUp('SESSION_SECRET in .env is missing or too short');
for (const file of ['server.key', 'server.crt', 'chain.crt']) {
    if (!fs.existsSync(at('certs', file))) notSetUp(`the HTTPS certificate certs/${file} is missing`);
}

// Fixed command (no user input); a shell is needed to find npx on Windows.
const result = spawnSync('npx prisma migrate deploy', { cwd: ROOT, shell: true, encoding: 'utf8' });
const output = `${result.stdout || ''}${result.stderr || ''}`;
if (result.status !== 0) {
    console.error(output);
    console.error('Could not bring the database up to date (see above).');
    process.exit(1);
}
if (/migrations? have been successfully applied|Applying migration/i.test(output)) {
    console.log('Database updated with new migrations.');
}
