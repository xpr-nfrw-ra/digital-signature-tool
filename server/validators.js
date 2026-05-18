// validators.js - Input size/shape limits enforced at the API boundary.
// SQLite does not enforce column length or character class, so these caps and
// patterns protect resources here. Password is intentionally length-only — it
// is hashed before storage, so its character class is irrelevant.

const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

const LIMITS = {
    username: {
        min: 3, max: 32,
        pattern: /^[a-zA-Z0-9_.-]+$/,
        patternMsg: 'may only contain letters, digits, dot, underscore, and hyphen',
    },
    password: { min: 6, max: 128 },
    label: {
        min: 1, max: 64,
        noControlChars: true,
    },
    documentName: {
        min: 1, max: 255,
        noControlChars: true,
        forbiddenChars: /[\/\\]/,
        forbiddenMsg: 'must not contain slashes or backslashes',
    },
    documentHash: {
        allowedLengths: [64, 96, 128], // SHA-256 / SHA-384 / SHA-512 hex
        pattern: /^[0-9a-f]+$/i,
        patternMsg: 'must be hex (SHA-256, SHA-384, or SHA-512)',
    },
    fingerprint: {
        exactLength: 64,
        pattern: /^[0-9a-f]{64}$/i,
        patternMsg: 'must be 64-char hex (SHA-256 of DER SPKI)',
    },
    publicKeyPem: {
        min: 100, max: 8192,
        pattern: /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/,
        patternMsg: 'must be a PEM-encoded SubjectPublicKeyInfo block',
    },
};

function checkString(name, value, limits) {
    if (typeof value !== 'string') {
        return `${name} must be a string`;
    }
    const v = name === 'password' ? value : value.trim();

    if (limits.exactLength != null && v.length !== limits.exactLength) {
        return `${name} must be exactly ${limits.exactLength} characters`;
    }
    if (limits.allowedLengths && !limits.allowedLengths.includes(v.length)) {
        return `${name} must be ${limits.allowedLengths.join(', ')} characters`;
    }
    if (limits.min != null && v.length < limits.min) {
        return `${name} must be at least ${limits.min} characters`;
    }
    if (limits.max != null && v.length > limits.max) {
        return `${name} must be at most ${limits.max} characters`;
    }
    if (limits.noControlChars && CONTROL_CHARS.test(v)) {
        return `${name} must not contain control characters`;
    }
    if (limits.forbiddenChars && limits.forbiddenChars.test(v)) {
        return `${name} ${limits.forbiddenMsg}`;
    }
    if (limits.pattern && !limits.pattern.test(v)) {
        return `${name} ${limits.patternMsg}`;
    }
    return null;
}

function validate(fields) {
    for (const [name, value] of Object.entries(fields)) {
        const limits = LIMITS[name];
        if (!limits) continue;
        const err = checkString(name, value, limits);
        if (err) return err;
    }
    return null;
}

module.exports = { LIMITS, validate, checkString };
