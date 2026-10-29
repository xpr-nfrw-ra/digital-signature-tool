// Pure unit tests for server/validators.js — no database involved.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../server/validators');

describe('validate', () => {
    it('accepts valid values', () => {
        assert.equal(validate({
            username: 'alice.b_c-1',
            password: 'secret1',
            label: 'Work key',
            documentName: 'report final.pdf',
            documentHash: 'A'.repeat(64),
            fingerprint: 'f'.repeat(64),
        }), null);
    });

    it('ignores fields it has no rules for', () => {
        assert.equal(validate({ somethingElse: 42 }), null);
    });

    it('rejects non-strings', () => {
        assert.match(validate({ username: 123 }), /must be a string/);
        assert.match(validate({ username: undefined }), /must be a string/);
    });

    it('enforces username length and characters', () => {
        assert.ok(validate({ username: 'ab' }));
        assert.ok(validate({ username: 'a'.repeat(33) }));
        assert.ok(validate({ username: 'has space' }));
        assert.ok(validate({ username: 'emoji😀' }));
        assert.equal(validate({ username: '  abc  ' }), null, 'username is trimmed before checking');
    });

    it('does not trim passwords (surrounding spaces count toward the length)', () => {
        assert.equal(validate({ password: '  ab  ' }), null);
        assert.ok(validate({ password: 'ab' }));
    });

    it('enforces document hash lengths for SHA-256/384/512 hex', () => {
        for (const len of [64, 96, 128]) assert.equal(validate({ documentHash: 'a'.repeat(len) }), null);
        for (const len of [63, 65, 80, 129]) assert.ok(validate({ documentHash: 'a'.repeat(len) }));
        assert.ok(validate({ documentHash: 'g'.repeat(64) }));
    });

    it('forbids control characters and path separators where required', () => {
        assert.ok(validate({ label: 'tab\there' }));
        assert.ok(validate({ documentName: 'a/b' }));
        assert.ok(validate({ documentName: 'a\\b' }));
        assert.ok(validate({ documentName: 'nul\u0000' }));
    });

    it('requires a PEM SubjectPublicKeyInfo block of sane size', () => {
        const body = 'A'.repeat(200);
        assert.equal(validate({ publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n` }), null);
        assert.ok(validate({ publicKeyPem: `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----` }));
        assert.ok(validate({ publicKeyPem: `-----BEGIN PUBLIC KEY-----\nAA\n-----END PUBLIC KEY-----` }), 'too short');
    });
});
