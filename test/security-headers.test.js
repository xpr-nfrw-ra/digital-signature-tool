const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { client, cleanup } = require('./helpers');

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
