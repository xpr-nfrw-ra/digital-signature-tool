// crypto.js - Core cryptographic functions
// RSA uses forge.js. ECDSA uses the browser's Web Crypto API (forge has no ECDSA);
// keys are exported as standard PKCS#8 / SPKI PEM and ECDSA signatures are DER-encoded,
// so both interoperate with OpenSSL and the server's Node crypto.

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
    URL.revokeObjectURL(url);
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

function webCryptoHash(hashAlgorithm) {
    const name = WEBCRYPTO_HASH[hashAlgorithm];
    if (!name) throw new Error('Unsupported hash algorithm: ' + hashAlgorithm);
    return name;
}

// ===== PEM <-> DER =====

function derToPem(der, label) {
    const bytes = new Uint8Array(der);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary).match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function pemToDer(pem, label) {
    const match = pem.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`));
    if (!match) throw new Error(`Not a "${label}" PEM block`);
    const binary = atob(match[1].replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// ===== Key type detection =====

// Web Crypto needs the curve up front when importing an EC key, so try each one;
// importing with the wrong curve fails.
async function importEcKey(der, format, usages) {
    for (const namedCurve of Object.values(ECDSA_CURVES)) {
        try {
            const key = await crypto.subtle.importKey(format, der, { name: 'ECDSA', namedCurve }, true, usages);
            return { key, namedCurve };
        } catch (_) {
            // try the next curve
        }
    }
    return null;
}

function isRsaPrivateKeyPem(pem) {
    try { forge.pki.privateKeyFromPem(pem); return true; } catch (_) { return false; }
}

function isRsaPublicKeyPem(pem) {
    try { forge.pki.publicKeyFromPem(pem); return true; } catch (_) { return false; }
}

async function importEcPrivateKeyPem(pem) {
    let der;
    try { der = pemToDer(pem, 'PRIVATE KEY'); } catch (_) { return null; }
    return importEcKey(der, 'pkcs8', ['sign']);
}

async function importEcPublicKeyPem(pem) {
    let der;
    try { der = pemToDer(pem, 'PUBLIC KEY'); } catch (_) { return null; }
    return importEcKey(der, 'spki', ['verify']);
}

// The algorithm is decided by the key itself, never by a setting, so a key can only
// ever be used with its own algorithm.
async function detectPrivateKeyAlgorithm(pem) {
    if (isRsaPrivateKeyPem(pem)) return 'rsa';
    if (await importEcPrivateKeyPem(pem)) return 'ecdsa';
    throw new Error('Unsupported or invalid private key (expected an RSA or ECDSA PEM key)');
}

async function detectPublicKeyAlgorithm(pem) {
    if (isRsaPublicKeyPem(pem)) return 'rsa';
    if (await importEcPublicKeyPem(pem)) return 'ecdsa';
    throw new Error('Unsupported or invalid public key (expected an RSA or ECDSA PEM key)');
}

// ===== ECDSA signature encoding (IEEE P1363 r||s <-> DER SEQUENCE { r INTEGER, s INTEGER }) =====

function derLength(n) {
    return n < 0x80 ? [n] : [0x81, n];
}

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
function derToP1363(der, componentBytes) {
    let pos = 0;
    function readLength() {
        let len = der[pos++];
        if (len === 0x81) len = der[pos++];
        else if (len & 0x80) return -1;
        return len;
    }
    function readInteger() {
        if (der[pos++] !== 0x02) return null;
        const len = readLength();
        if (len <= 0 || pos + len > der.length) return null;
        let value = der.slice(pos, pos + len);
        pos += len;
        while (value.length > 1 && value[0] === 0) value = value.slice(1);
        if (value.length > componentBytes) return null;
        const padded = new Uint8Array(componentBytes);
        padded.set(value, componentBytes - value.length);
        return padded;
    }
    if (der[pos++] !== 0x30) return null;
    const seqLen = readLength();
    if (seqLen < 0 || pos + seqLen !== der.length) return null;
    const r = readInteger();
    const s = r && readInteger();
    if (!r || !s || pos !== der.length) return null;
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

// SHA-256 fingerprint of a forge RSA public key (DER-encoded SubjectPublicKeyInfo), as hex.
// Matches the server-side fingerprint computed by Node's crypto module.
function fingerprintFromPublicKey(publicKey) {
    const asn1 = forge.pki.publicKeyToAsn1(publicKey);
    const derBytes = forge.asn1.toDer(asn1).getBytes();
    const md = forge.md.sha256.create();
    md.update(derBytes);
    return md.digest().toHex();
}

// Derive the matching public-key fingerprint from a private-key PEM (RSA or ECDSA).
async function fingerprintFromPrivateKeyPem(privateKeyPem) {
    if (isRsaPrivateKeyPem(privateKeyPem)) {
        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
        return fingerprintFromPublicKey(publicKey);
    }
    const ec = await importEcPrivateKeyPem(privateKeyPem);
    if (!ec) throw new Error('Unsupported or invalid private key');
    // The private JWK carries the public point (x, y); rebuild the public key from it.
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', ec.key);
    const publicKey = await crypto.subtle.importKey('jwk', { kty, crv, x, y }, { name: 'ECDSA', namedCurve: crv }, true, ['verify']);
    const spki = await crypto.subtle.exportKey('spki', publicKey);
    return bytesToHex(await crypto.subtle.digest('SHA-256', spki));
}

// SHA-256 fingerprint of a public-key PEM (RSA or EC): hash of the DER SPKI, as hex.
async function fingerprintFromPublicKeyPem(publicKeyPem) {
    return bytesToHex(await crypto.subtle.digest('SHA-256', pemToDer(publicKeyPem, 'PUBLIC KEY')));
}

// Hex digest using the browser's native hashing (fast for large files).
async function digestHex(fileData, hashAlgorithm) {
    return bytesToHex(await crypto.subtle.digest(webCryptoHash(hashAlgorithm), fileData));
}

// Hex digest of file content using the chosen hash algorithm.
function hashFileHex(fileData, hashAlgorithm) {
    const md = forge.md[hashAlgorithm].create();
    md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
    return md.digest().toHex();
}

// ===== Key generation =====

function generateRSAKeyPair(keySize) {
    return new Promise((resolve, reject) => {
        forge.pki.rsa.generateKeyPair({ bits: parseInt(keySize), workers: 2 }, (err, keypair) => {
            if (err) reject(err);
            else resolve({
                privateKeyPem: forge.pki.privateKeyToPem(keypair.privateKey),
                publicKeyPem: forge.pki.publicKeyToPem(keypair.publicKey),
            });
        });
    });
}

async function generateECDSAKeyPair(keySize) {
    const namedCurve = ECDSA_CURVES[String(keySize)];
    if (!namedCurve) throw new Error('Unsupported ECDSA key size: ' + keySize);
    const keypair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, ['sign', 'verify']);
    return {
        privateKeyPem: derToPem(await crypto.subtle.exportKey('pkcs8', keypair.privateKey), 'PRIVATE KEY'),
        publicKeyPem: derToPem(await crypto.subtle.exportKey('spki', keypair.publicKey), 'PUBLIC KEY'),
    };
}

// Returns { privateKeyPem, publicKeyPem }.
async function generateKeyPair(keySize, algorithm) {
    if (algorithm === 'rsa') return generateRSAKeyPair(keySize);
    if (algorithm === 'ecdsa') return generateECDSAKeyPair(keySize);
    throw new Error('Unsupported algorithm: ' + algorithm);
}

// ===== Signing =====

function signFileRSA(fileData, privateKeyPem, hashAlgorithm) {
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const md = forge.md[hashAlgorithm].create();
    md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
    return forge.util.encode64(privateKey.sign(md));
}

async function signFileECDSA(fileData, privateKeyPem, hashAlgorithm) {
    const ec = await importEcPrivateKeyPem(privateKeyPem);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: webCryptoHash(hashAlgorithm) }, ec.key, fileData);
    return bytesToBase64(p1363ToDer(sig));
}

// Signs with whatever algorithm the private key is for. Returns { alg, signature }.
async function signFile(fileData, privateKeyPem, hashAlgorithm) {
    const alg = await detectPrivateKeyAlgorithm(privateKeyPem);
    try {
        const signature = alg === 'rsa'
            ? signFileRSA(fileData, privateKeyPem, hashAlgorithm)
            : await signFileECDSA(fileData, privateKeyPem, hashAlgorithm);
        return { alg, signature };
    } catch (error) {
        throw new Error(`Failed to sign file with ${alg.toUpperCase()}: ${error.message}`);
    }
}

// ===== Verification =====
// A signature that can't be matched against this file + key (wrong size, malformed
// bytes, wrong hash, wrong key) is reported as invalid rather than throwing — it is
// not valid, regardless of why. Only an unusable public key throws.

function verifySignatureRSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    try {
        const md = forge.md[hashAlgorithm].create();
        md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
        return publicKey.verify(md.digest().bytes(), forge.util.decode64(signatureBase64));
    } catch (_) {
        return false;
    }
}

async function verifySignatureECDSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    const ec = await importEcPublicKeyPem(publicKeyPem);
    try {
        const raw = derToP1363(base64ToBytes(signatureBase64), CURVE_BYTES[ec.namedCurve]);
        if (!raw) return false;
        return await crypto.subtle.verify({ name: 'ECDSA', hash: webCryptoHash(hashAlgorithm) }, ec.key, raw, fileData);
    } catch (_) {
        return false;
    }
}

// Verifies with whatever algorithm the public key is for. Returns { alg, valid }.
// (Signature files made before real ECDSA existed may say "ecdsa" but hold an RSA
// signature from an RSA key; going by the key keeps those verifiable.)
async function verifySignature(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    const alg = await detectPublicKeyAlgorithm(publicKeyPem);
    const valid = alg === 'rsa'
        ? verifySignatureRSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm)
        : await verifySignatureECDSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm);
    return { alg, valid };
}
