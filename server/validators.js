// validators.js - Input size/shape limits enforced at the API boundary.
// SQLite does not enforce column length, so these caps protect resources here.

const LIMITS = {
    username:     { min: 3,   max: 32 },
    password:     { min: 6,   max: 128 },
    label:        { min: 1,   max: 64 },
    documentName: { min: 1,   max: 255 },
    documentHash: { min: 1,   max: 128 }, // hex of up to SHA-512 (64 bytes -> 128 chars)
    fingerprint:  { min: 1,   max: 128 },
    publicKeyPem: { min: 1,   max: 8192 },
};

function checkString(name, value, { min, max }) {
    if (typeof value !== 'string') {
        return `${name} must be a string`;
    }
    const trimmed = name === 'password' ? value : value.trim();
    if (trimmed.length < min) {
        return `${name} must be at least ${min} characters`;
    }
    if (trimmed.length > max) {
        return `${name} must be at most ${max} characters`;
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
