// crypto.js - Core cryptographic functions, all on the browser's Web Crypto API.
// RSA signatures are RSASSA-PKCS1-v1_5 and ECDSA signatures are DER-encoded; keys are
// exported as PKCS#8 / SPKI PEM. Everything interoperates with OpenSSL and the server's
// Node crypto. Web Crypto hashes natively, so large files are fast and never build
// huge strings in memory.

// Utility: Download file
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Some browsers start the download asynchronously; revoking at once can cancel it.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Utility: Read file as text
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

// Utility: Read file as ArrayBuffer
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// ===== Algorithm parameters =====

// The key-size setting is stored as an RSA bit size; for ECDSA each tier maps to a curve.
const ECDSA_CURVES = { '2048': 'P-256', '3072': 'P-384', '4096': 'P-521' };
// Bytes per signature component (r or s) for each curve.
const CURVE_BYTES = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };
const WEBCRYPTO_HASH = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
const RSA_ALG = 'RSASSA-PKCS1-v1_5';

function webCryptoHash(hashAlgorithm) {
    const name = WEBCRYPTO_HASH[hashAlgorithm];
    if (!name) throw new Error('Unsupported hash algorithm: ' + hashAlgorithm);
    return name;
}

// ===== DER building blocks (just enough to re-wrap key formats) =====

function derLength(n) {
    if (n < 0x80) return [n];
    const bytes = [];
    for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
    return [0x80 | bytes.length, ...bytes];
}

function derTlv(tag, content) {
    return new Uint8Array([tag, ...derLength(content.length), ...content]);
}

const concatBytes = (...parts) => parts.reduce((acc, p) => new Uint8Array([...acc, ...p]), new Uint8Array());

const OID = {
    rsaEncryption: [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01],
    ecPublicKey: [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01],
    'P-256': [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07],
    'P-384': [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22],
    'P-521': [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x23],
};
const RSA_ALGORITHM_ID = derTlv(0x30, [...OID.rsaEncryption, 0x05, 0x00]);
const PKCS8_VERSION = [0x02, 0x01, 0x00];

// "BEGIN RSA PRIVATE KEY" (PKCS#1) -> PKCS#8 PrivateKeyInfo
function pkcs1PrivateToPkcs8(pkcs1) {
    return derTlv(0x30, concatBytes(PKCS8_VERSION, RSA_ALGORITHM_ID, derTlv(0x04, pkcs1)));
}

// "BEGIN EC PRIVATE KEY" (SEC1) -> PKCS#8 for the given curve
function sec1ToPkcs8(sec1, curve) {
    return derTlv(0x30, concatBytes(PKCS8_VERSION, derTlv(0x30, [...OID.ecPublicKey, ...OID[curve]]), derTlv(0x04, sec1)));
}

// "BEGIN RSA PUBLIC KEY" (PKCS#1) -> SubjectPublicKeyInfo
function pkcs1PublicToSpki(pkcs1) {
    return derTlv(0x30, concatBytes(RSA_ALGORITHM_ID, derTlv(0x03, concatBytes([0x00], pkcs1))));
}

// ===== PEM <-> DER =====

function derToPem(derBytes, label) {
    const b64 = bytesToBase64(new Uint8Array(derBytes)).match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function pemToDer(pem, label) {
    const match = pem.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`));
    if (!match) throw new Error(`Not a "${label}" PEM block`);
    return base64ToBytes(match[1].replace(/\s+/g, ''));
}

// Returns { label, der } for the first PEM block in the text, or null.
function firstPemBlock(pem) {
    const match = String(pem).match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]+?)-----END \1-----/);
    if (!match) return null;
    try {
        return { label: match[1], der: base64ToBytes(match[2].replace(/\s+/g, '')) };
    } catch (_) {
        return null;
    }
}

// ===== Key import =====
// The algorithm is decided by the key itself, never by a setting, so a key can only ever
// be used with its own algorithm. RSA keys are bound to a hash when imported.

const PRIVATE_KEY_ERROR = 'Unsupported or invalid private key (expected an RSA or ECDSA private key in PEM format)';
const PUBLIC_KEY_ERROR = 'Unsupported or invalid public key (expected an RSA or ECDSA public key in PEM format)';

async function tryImport(format, keyData, algorithm, usages) {
    try {
        return await crypto.subtle.importKey(format, keyData, algorithm, true, usages);
    } catch (_) {
        return null;
    }
}

async function importRsaOrEc(format, keyData, hashAlgorithm, usages) {
    const rsa = await tryImport(format, keyData, { name: RSA_ALG, hash: webCryptoHash(hashAlgorithm) }, usages);
    if (rsa) return { alg: 'rsa', key: rsa };
    for (const namedCurve of Object.values(ECDSA_CURVES)) {
        const ec = await tryImport(format, keyData, { name: 'ECDSA', namedCurve }, usages);
        if (ec) return { alg: 'ecdsa', key: ec, namedCurve };
    }
    return null;
}

// Accepts PKCS#8 ("PRIVATE KEY"), PKCS#1 ("RSA PRIVATE KEY") and SEC1 ("EC PRIVATE KEY").
// Returns { alg, key, namedCurve? }.
async function importPrivateKey(pem, hashAlgorithm = 'sha256') {
    const block = firstPemBlock(pem);
    let result = null;
    if (block && block.label === 'PRIVATE KEY') {
        result = await importRsaOrEc('pkcs8', block.der, hashAlgorithm, ['sign']);
    } else if (block && block.label === 'RSA PRIVATE KEY') {
        const key = await tryImport('pkcs8', pkcs1PrivateToPkcs8(block.der), { name: RSA_ALG, hash: webCryptoHash(hashAlgorithm) }, ['sign']);
        if (key) result = { alg: 'rsa', key };
    } else if (block && block.label === 'EC PRIVATE KEY') {
        for (const namedCurve of Object.values(ECDSA_CURVES)) {
            const key = await tryImport('pkcs8', sec1ToPkcs8(block.der, namedCurve), { name: 'ECDSA', namedCurve }, ['sign']);
            if (key) { result = { alg: 'ecdsa', key, namedCurve }; break; }
        }
    } else if (block && block.label === 'ENCRYPTED PRIVATE KEY') {
        throw new Error('This private key is password-protected. Export it without a password (e.g. openssl pkey -in key.pem -out plain.pem) and try again.');
    }
    if (!result) throw new Error(PRIVATE_KEY_ERROR);
    return result;
}

// Accepts SPKI ("PUBLIC KEY") and PKCS#1 ("RSA PUBLIC KEY"). Returns { alg, key, namedCurve? }.
async function importPublicKey(pem, hashAlgorithm = 'sha256') {
    const block = firstPemBlock(pem);
    let result = null;
    if (block && block.label === 'PUBLIC KEY') {
        result = await importRsaOrEc('spki', block.der, hashAlgorithm, ['verify']);
    } else if (block && block.label === 'RSA PUBLIC KEY') {
        const key = await tryImport('spki', pkcs1PublicToSpki(block.der), { name: RSA_ALG, hash: webCryptoHash(hashAlgorithm) }, ['verify']);
        if (key) result = { alg: 'rsa', key };
    }
    if (!result) throw new Error(PUBLIC_KEY_ERROR);
    return result;
}

async function detectPrivateKeyAlgorithm(pem) {
    return (await importPrivateKey(pem)).alg;
}

async function detectPublicKeyAlgorithm(pem) {
    return (await importPublicKey(pem)).alg;
}

// ===== ECDSA signature encoding (IEEE P1363 r||s <-> DER SEQUENCE { r INTEGER, s INTEGER }) =====

function derInteger(bytes) {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let value = Array.from(bytes.slice(i));
    if (value[0] & 0x80) value = [0, ...value];
    return [0x02, ...derLength(value.length), ...value];
}

function p1363ToDer(sig) {
    const bytes = new Uint8Array(sig);
    const half = bytes.length / 2;
    const body = [...derInteger(bytes.slice(0, half)), ...derInteger(bytes.slice(half))];
    return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

// Returns null for anything that isn't a well-formed signature for this curve size.
function derToP1363(derSig, componentBytes) {
    let pos = 0;
    function readLength() {
        let len = derSig[pos++];
        if (len === 0x81) len = derSig[pos++];
        else if (len & 0x80) return -1;
        return len;
    }
    function readInteger() {
        if (derSig[pos++] !== 0x02) return null;
        const len = readLength();
        if (len <= 0 || pos + len > derSig.length) return null;
        let value = derSig.slice(pos, pos + len);
        pos += len;
        while (value.length > 1 && value[0] === 0) value = value.slice(1);
        if (value.length > componentBytes) return null;
        const padded = new Uint8Array(componentBytes);
        padded.set(value, componentBytes - value.length);
        return padded;
    }
    if (derSig[pos++] !== 0x30) return null;
    const seqLen = readLength();
    if (seqLen < 0 || pos + seqLen !== derSig.length) return null;
    const r = readInteger();
    const s = r && readInteger();
    if (!r || !s || pos !== derSig.length) return null;
    const out = new Uint8Array(componentBytes * 2);
    out.set(r, 0);
    out.set(s, componentBytes);
    return out;
}

function base64ToBytes(b64) {
    const binary = atob(b64.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// ===== Fingerprints and hashes =====

function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

// Short display form of a fingerprint: first and last 8 hex characters.
function shortFp(fp) {
    return fp.length > 16 ? `${fp.slice(0, 8)}…${fp.slice(-8)}` : fp;
}

async function spkiFingerprint(publicKey) {
    const spki = await crypto.subtle.exportKey('spki', publicKey);
    return bytesToHex(await crypto.subtle.digest('SHA-256', spki));
}

// SHA-256 of the DER SubjectPublicKeyInfo, as hex (the standard X.509 key fingerprint,
// matching the server). Derived from the private key: its JWK carries the public part.
async function fingerprintFromPrivateKeyPem(privateKeyPem) {
    const { alg, key } = await importPrivateKey(privateKeyPem);
    const jwk = await crypto.subtle.exportKey('jwk', key);
    const publicKey = alg === 'rsa'
        ? await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, { name: RSA_ALG, hash: 'SHA-256' }, true, ['verify'])
        : await crypto.subtle.importKey('jwk', { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: jwk.crv }, true, ['verify']);
    return spkiFingerprint(publicKey);
}

// Same fingerprint from a public-key PEM (re-encoded, so a PKCS#1 RSA key matches its SPKI form).
async function fingerprintFromPublicKeyPem(publicKeyPem) {
    return spkiFingerprint((await importPublicKey(publicKeyPem)).key);
}

// Hex digest of file content using the chosen hash algorithm.
async function digestHex(fileData, hashAlgorithm) {
    return bytesToHex(await crypto.subtle.digest(webCryptoHash(hashAlgorithm), fileData));
}

// ===== Key generation =====

// Returns { privateKeyPem, publicKeyPem } as PKCS#8 / SPKI PEM.
async function generateKeyPair(keySize, algorithm) {
    let params;
    if (algorithm === 'rsa') {
        const modulusLength = Number(keySize);
        if (![2048, 3072, 4096].includes(modulusLength)) throw new Error('Unsupported RSA key size: ' + keySize);
        params = { name: RSA_ALG, modulusLength, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    } else if (algorithm === 'ecdsa') {
        const namedCurve = ECDSA_CURVES[String(keySize)];
        if (!namedCurve) throw new Error('Unsupported ECDSA key size: ' + keySize);
        params = { name: 'ECDSA', namedCurve };
    } else {
        throw new Error('Unsupported algorithm: ' + algorithm);
    }
    const keypair = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
    return {
        privateKeyPem: derToPem(await crypto.subtle.exportKey('pkcs8', keypair.privateKey), 'PRIVATE KEY'),
        publicKeyPem: derToPem(await crypto.subtle.exportKey('spki', keypair.publicKey), 'PUBLIC KEY'),
    };
}

// ===== Signing =====

// Signs with whatever algorithm the private key is for. Returns { alg, signature } with
// the signature base64-encoded (RSA: PKCS#1 v1.5 bytes; ECDSA: DER).
async function signFile(fileData, privateKeyPem, hashAlgorithm) {
    const { alg, key } = await importPrivateKey(privateKeyPem, hashAlgorithm);
    try {
        if (alg === 'rsa') {
            return { alg, signature: bytesToBase64(new Uint8Array(await crypto.subtle.sign(RSA_ALG, key, fileData))) };
        }
        const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: webCryptoHash(hashAlgorithm) }, key, fileData);
        return { alg, signature: bytesToBase64(p1363ToDer(sig)) };
    } catch (error) {
        throw new Error(`Failed to sign file with ${alg.toUpperCase()}: ${error.message}`);
    }
}

// ===== Verification =====
// A signature that can't be matched against this file + key (wrong size, malformed
// bytes, wrong hash, wrong key) is reported as invalid rather than throwing — it is
// not valid, regardless of why. Only an unusable public key or hash throws.

// Verifies with whatever algorithm the public key is for. Returns { alg, valid }.
// (Signature files made before real ECDSA existed may say "ecdsa" but hold an RSA
// signature from an RSA key; going by the key keeps those verifiable.)
async function verifySignature(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    const { alg, key, namedCurve } = await importPublicKey(publicKeyPem, hashAlgorithm);
    try {
        const sig = base64ToBytes(signatureBase64);
        if (alg === 'rsa') {
            return { alg, valid: await crypto.subtle.verify(RSA_ALG, key, sig, fileData) };
        }
        const raw = derToP1363(sig, CURVE_BYTES[namedCurve]);
        if (!raw) return { alg, valid: false };
        return { alg, valid: await crypto.subtle.verify({ name: 'ECDSA', hash: webCryptoHash(hashAlgorithm) }, key, raw, fileData) };
    } catch (_) {
        return { alg, valid: false };
    }
}
