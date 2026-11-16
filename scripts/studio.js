// studio.js - npm run db: open Prisma Studio on the database named in .env.
// Prisma 7's Studio reads the database type from the text before "://", so it rejects
// the "file:./dev.db" form the app and migrations use. Pass it an absolute file:/// URL instead.
// Extra arguments go through to Prisma Studio, e.g. npm run db -- --port 5556
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error('DATABASE_URL is not set. Run "npm run setup" first.');
    process.exit(1);
}

// Relative SQLite paths are relative to the project root (where prisma.config.ts lives).
const url = dbUrl.startsWith('file:') && !dbUrl.startsWith('file://')
    ? pathToFileURL(path.resolve(root, dbUrl.slice('file:'.length))).href
    : dbUrl;

// Prisma 7 picks a different port on each run; keep the documented 5555 unless one is given.
const extraArgs = process.argv.slice(2);
const portGiven = extraArgs.some(a => a === '--port' || a === '-p' || a.startsWith('--port='));
const portArgs = portGiven ? [] : ['--port', '5555'];

const prismaCli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, 'studio', '--url', url, ...portArgs, ...extraArgs], {
    cwd: root,
    stdio: 'inherit',
});
process.exit(result.status ?? 1);
