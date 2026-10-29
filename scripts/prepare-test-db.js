// prepare-test-db.js - Build a freshly migrated template database for the test suite.
// Each test file copies this template (see test/helpers.js), so files can run in parallel.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const tmpDir = path.join(__dirname, '..', 'test', '.tmp');
const templatePath = path.join(tmpDir, 'template.db');

fs.mkdirSync(tmpDir, { recursive: true });
fs.rmSync(templatePath, { force: true });

// Prisma 7's `migrate dev` no longer regenerates the client, so a schema change would
// otherwise be tested against a stale client.
execSync('npx prisma generate', {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
});

execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: 'file:' + templatePath },
    stdio: ['ignore', 'ignore', 'inherit'],
});
