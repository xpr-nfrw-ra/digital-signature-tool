const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, client, cleanup } = require('./helpers');

after(cleanup);

function directives(header) {
    return Object.fromEntries(header.split(';').map(d => d.trim()).filter(Boolean).map(d => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values];
    }));
}

describe('Content Security Policy', () => {
    it('is sent with the page and forbids inline and third-party scripts and styles', async () => {
        const res = await client().get('/');
        assert.equal(res.status, 200);
        const csp = directives(res.headers['content-security-policy']);
        assert.deepEqual(csp['script-src'], ["'self'"]);
        assert.deepEqual(csp['script-src-attr'], ["'none'"]);
        assert.deepEqual(csp['style-src'], ["'self'"]);
        assert.deepEqual(csp['object-src'], ["'none'"]);
        assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
        assert.deepEqual(csp['default-src'], ["'self'"]);
    });

    it('the page has no inline scripts, event-handler attributes or style attributes', async () => {
        const html = (await client().get('/')).text;
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline <script> would be blocked');
        assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'onclick-style attributes would be blocked');
        assert.doesNotMatch(html, /\sstyle\s*=/i, 'style="" attributes would be blocked');
    });
});

describe('error responses', () => {
    const post = (body, type = 'application/json') => request(app).post('/api/auth/login')
        .set('X-Forwarded-Proto', 'https').set('Content-Type', type).send(body);

    it('malformed JSON gets a short JSON 400, never a stack trace', async () => {
        const res = await post('{"username":');
        assert.equal(res.status, 400);
        assert.match(res.headers['content-type'], /application\/json/);
        assert.deepEqual(res.body, { error: 'Malformed request body' });
        assert.doesNotMatch(res.text, /node_modules|at \w|\.js:\d+/);
    });

    it('an oversized body gets a JSON 413', async () => {
        const res = await post(JSON.stringify({ username: 'x'.repeat(200 * 1024), password: 'y' }));
        assert.equal(res.status, 413);
        assert.deepEqual(res.body, { error: 'Request body is too large' });
    });

    it('unknown API routes get a JSON 404', async () => {
        const res = await client().get('/api/does-not-exist');
        assert.equal(res.status, 404);
        assert.deepEqual(res.body, { error: 'Not found' });
    });
});
