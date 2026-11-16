// Tests the browser crypto code (public/js/crypto.js) by running it in a sandbox that
// provides the browser globals it needs (Web Crypto, atob/btoa).
// Node's own crypto (OpenSSL) is used as an independent reference implementation.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const { registeredClient, sha256Hex, cleanup } = require('./helpers');
const { fingerprintFromPem } = require('../server/keys');

after(cleanup);

function loadBrowserCrypto() {
    // Share the host's binary types so Web Crypto output and our byte arrays mix freely
    // (in a browser there is only one realm).
    const sandbox = {
        crypto: globalThis.crypto, atob, btoa, setTimeout, clearTimeout, console,
        ArrayBuffer, Uint8Array, DataView, TextEncoder,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    for (const file of ['public/js/crypto.js']) {
        const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        vm.runInContext(code, sandbox, { filename: file });
    }
    return sandbox;
}

const bc = loadBrowserCrypto();
const plain = o => JSON.parse(JSON.stringify(o));
const FILE = new TextEncoder().encode('The quick brown fox signs the contract.').buffer;
const TAMPERED = new TextEncoder().encode('The quick brown fox signs the contract!').buffer;
const NODE_CURVE = { 'P-256': 'prime256v1', 'P-384': 'secp384r1', 'P-521': 'secp521r1' };
const NODE_HASH = { sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' };

const ecKeys = {}; // keySize tier -> { privateKeyPem, publicKeyPem }
let rsaKeys;

before(async () => {
    for (const tier of ['2048', '3072', '4096']) {
        ecKeys[tier] = await bc.generateKeyPair(tier, 'ecdsa');
    }
    const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    rsaKeys = {
        privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }),
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    };
});

describe('ECDSA key generation', () => {
    for (const [tier, curve] of Object.entries({ 2048: 'P-256', 3072: 'P-384', 4096: 'P-521' })) {
        it(`key size ${tier} produces a real ${curve} key in standard PEM`, () => {
            const { privateKeyPem, publicKeyPem } = ecKeys[tier];
            assert.match(privateKeyPem, /^-----BEGIN PRIVATE KEY-----\n/);
            assert.match(publicKeyPem, /^-----BEGIN PUBLIC KEY-----\n/);

            const pub = nodeCrypto.createPublicKey(publicKeyPem);
            const priv = nodeCrypto.createPrivateKey(privateKeyPem);
            assert.equal(pub.asymmetricKeyType, 'ec');
            assert.equal(pub.asymmetricKeyDetails.namedCurve, NODE_CURVE[curve]);
            assert.equal(priv.asymmetricKeyDetails.namedCurve, NODE_CURVE[curve]);
        });
    }

    it('RSA generation still works and returns PEM strings', async () => {
        const { privateKeyPem, publicKeyPem } = await bc.generateKeyPair('2048', 'rsa');
        assert.equal(nodeCrypto.createPublicKey(publicKeyPem).asymmetricKeyType, 'rsa');
        assert.equal(nodeCrypto.createPrivateKey(privateKeyPem).asymmetricKeyDetails.modulusLength, 2048);
    });
});

describe('algorithm comes from the key', () => {
    it('detects RSA and ECDSA private and public keys', async () => {
        assert.equal(await bc.detectPrivateKeyAlgorithm(rsaKeys.privateKeyPem), 'rsa');
        assert.equal(await bc.detectPublicKeyAlgorithm(rsaKeys.publicKeyPem), 'rsa');
        assert.equal(await bc.detectPrivateKeyAlgorithm(ecKeys['2048'].privateKeyPem), 'ecdsa');
        assert.equal(await bc.detectPublicKeyAlgorithm(ecKeys['2048'].publicKeyPem), 'ecdsa');
    });

    it('rejects things that are not keys', async () => {
        await assert.rejects(bc.detectPrivateKeyAlgorithm('hello'), /Unsupported or invalid private key/);
        await assert.rejects(bc.detectPublicKeyAlgorithm(ecKeys['2048'].privateKeyPem), /Unsupported or invalid public key/);
    });

    it('signFile reports the key\'s algorithm', async () => {
        assert.equal((await bc.signFile(FILE, rsaKeys.privateKeyPem, 'sha256')).alg, 'rsa');
        assert.equal((await bc.signFile(FILE, ecKeys['2048'].privateKeyPem, 'sha256')).alg, 'ecdsa');
    });
});

describe('ECDSA sign and verify', () => {
    for (const tier of ['2048', '3072', '4096']) {
        for (const hash of ['sha256', 'sha384', 'sha512']) {
            it(`${tier} tier with ${hash}: valid, interoperable with OpenSSL, rejects tampering`, async () => {
                const { privateKeyPem, publicKeyPem } = ecKeys[tier];
                const { signature } = await bc.signFile(FILE, privateKeyPem, hash);

                assert.deepEqual(plain(await bc.verifySignature(FILE, signature, publicKeyPem, hash)), { alg: 'ecdsa', valid: true });
                assert.equal((await bc.verifySignature(TAMPERED, signature, publicKeyPem, hash)).valid, false);

                // Our DER signature verifies with Node/OpenSSL...
                const der = Buffer.from(signature, 'base64');
                assert.ok(nodeCrypto.verify(NODE_HASH[hash], Buffer.from(FILE), publicKeyPem, der), 'OpenSSL rejected our signature');
                // ...and an OpenSSL signature verifies with ours.
                const nodeSig = nodeCrypto.sign(NODE_HASH[hash], Buffer.from(FILE), privateKeyPem).toString('base64');
                assert.equal((await bc.verifySignature(FILE, nodeSig, publicKeyPem, hash)).valid, true);
            });
        }
    }

    it('rejects a signature checked with the wrong key or wrong hash', async () => {
        const { signature } = await bc.signFile(FILE, ecKeys['2048'].privateKeyPem, 'sha256');
        const other = await bc.generateKeyPair('2048', 'ecdsa');
        assert.equal((await bc.verifySignature(FILE, signature, other.publicKeyPem, 'sha256')).valid, false);
        assert.equal((await bc.verifySignature(FILE, signature, ecKeys['3072'].publicKeyPem, 'sha256')).valid, false);
        assert.equal((await bc.verifySignature(FILE, signature, ecKeys['2048'].publicKeyPem, 'sha384')).valid, false);
    });

    it('treats malformed signatures as invalid instead of throwing', async () => {
        const { publicKeyPem, privateKeyPem } = ecKeys['2048'];
        const { signature } = await bc.signFile(FILE, privateKeyPem, 'sha256');
        const der = Buffer.from(signature, 'base64');
        const rawP1363 = new Uint8Array(await globalThis.crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            await globalThis.crypto.subtle.importKey('pkcs8', bc.pemToDer(privateKeyPem, 'PRIVATE KEY'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
            FILE,
        ));
        for (const bad of [
            '',
            'not base64 at all!!',
            Buffer.from('garbage').toString('base64'),
            der.subarray(0, der.length - 1).toString('base64'),           // truncated
            Buffer.concat([der, Buffer.from([0])]).toString('base64'),     // trailing byte
            Buffer.from(rawP1363).toString('base64'),                      // raw r||s, not DER
        ]) {
            assert.equal((await bc.verifySignature(FILE, bad, publicKeyPem, 'sha256')).valid, false, JSON.stringify(bad));
        }
    });
});

describe('RSA sign and verify (Web Crypto)', () => {
    for (const bits of ['2048', '3072', '4096']) {
        it(`generates RSA-${bits} keys as PKCS#8 / SPKI PEM with exponent 65537`, async () => {
            const { privateKeyPem, publicKeyPem } = await bc.generateKeyPair(bits, 'rsa');
            assert.match(privateKeyPem, /^-----BEGIN PRIVATE KEY-----\n/);
            assert.match(publicKeyPem, /^-----BEGIN PUBLIC KEY-----\n/);
            const details = nodeCrypto.createPublicKey(publicKeyPem).asymmetricKeyDetails;
            assert.equal(details.modulusLength, Number(bits));
            assert.equal(details.publicExponent, 65537n);
            assert.equal(nodeCrypto.createPrivateKey(privateKeyPem).asymmetricKeyType, 'rsa');
        });
    }

    for (const hash of ['sha256', 'sha384', 'sha512']) {
        it(`${hash}: valid, interoperable with OpenSSL both ways, rejects tampering and wrong hash`, async () => {
            const { signature } = await bc.signFile(FILE, rsaKeys.privateKeyPem, hash);
            assert.deepEqual(plain(await bc.verifySignature(FILE, signature, rsaKeys.publicKeyPem, hash)), { alg: 'rsa', valid: true });
            assert.equal((await bc.verifySignature(TAMPERED, signature, rsaKeys.publicKeyPem, hash)).valid, false);
            const other = hash === 'sha256' ? 'sha384' : 'sha256';
            assert.equal((await bc.verifySignature(FILE, signature, rsaKeys.publicKeyPem, other)).valid, false);
            assert.ok(nodeCrypto.verify(NODE_HASH[hash], Buffer.from(FILE), rsaKeys.publicKeyPem, Buffer.from(signature, 'base64')));
            const nodeSig = nodeCrypto.sign(NODE_HASH[hash], Buffer.from(FILE), rsaKeys.privateKeyPem).toString('base64');
            assert.equal((await bc.verifySignature(FILE, nodeSig, rsaKeys.publicKeyPem, hash)).valid, true);
        });
    }

    it('accepts PKCS#1 and PKCS#8 RSA private keys and PKCS#1 RSA public keys', async () => {
        const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
        const pkcs1Pub = publicKey.export({ type: 'pkcs1', format: 'pem' });
        const spki = publicKey.export({ type: 'spki', format: 'pem' });
        const { signature } = await bc.signFile(FILE, pkcs8, 'sha256');
        assert.equal((await bc.verifySignature(FILE, signature, pkcs1Pub, 'sha256')).valid, true);
        assert.equal(await bc.fingerprintFromPublicKeyPem(pkcs1Pub), fingerprintFromPem(spki));
        assert.equal(await bc.fingerprintFromPrivateKeyPem(pkcs8), fingerprintFromPem(spki));
    });

    it('signs and verifies large files (no call-stack or memory blow-up)', async () => {
        const big = new Uint8Array(40 * 1024 * 1024);
        for (let i = 0; i < big.length; i += 4096) big[i] = i & 0xff;
        const { signature } = await bc.signFile(big.buffer, rsaKeys.privateKeyPem, 'sha256');
        assert.equal((await bc.verifySignature(big.buffer, signature, rsaKeys.publicKeyPem, 'sha256')).valid, true);
        assert.ok(nodeCrypto.verify('sha256', Buffer.from(big.buffer), rsaKeys.publicKeyPem, Buffer.from(signature, 'base64')));
    });

    it('treats malformed RSA signatures as invalid instead of throwing', async () => {
        const { signature } = await bc.signFile(FILE, rsaKeys.privateKeyPem, 'sha256');
        const sig = Buffer.from(signature, 'base64');
        for (const bad of ['', 'not base64!!', sig.subarray(1).toString('base64'), Buffer.concat([sig, Buffer.from([0])]).toString('base64')]) {
            assert.equal((await bc.verifySignature(FILE, bad, rsaKeys.publicKeyPem, 'sha256')).valid, false, JSON.stringify(bad));
        }
    });

    it('refuses an unknown hash instead of reporting a result', async () => {
        const { signature } = await bc.signFile(FILE, rsaKeys.privateKeyPem, 'sha256');
        await assert.rejects(bc.verifySignature(FILE, signature, rsaKeys.publicKeyPem, 'md5'), /Unsupported hash algorithm/);
    });
});

describe('key formats', () => {
    it('accepts SEC1 ("EC PRIVATE KEY") keys on every curve', async () => {
        for (const curve of Object.values(NODE_CURVE)) {
            const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: curve });
            const sec1 = privateKey.export({ type: 'sec1', format: 'pem' });
            const spki = publicKey.export({ type: 'spki', format: 'pem' });
            const { alg, signature } = await bc.signFile(FILE, sec1, 'sha256');
            assert.equal(alg, 'ecdsa');
            assert.equal((await bc.verifySignature(FILE, signature, spki, 'sha256')).valid, true);
            assert.equal(await bc.fingerprintFromPrivateKeyPem(sec1), fingerprintFromPem(spki));
        }
    });

    it('explains password-protected keys instead of calling them invalid', async () => {
        const { privateKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const encrypted = privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' });
        await assert.rejects(bc.signFile(FILE, encrypted, 'sha256'), /password-protected/);
    });
});

describe('legacy signatures', () => {

    it('an old "ecdsa" signature made with an RSA key still verifies', async () => {
        // Before real ECDSA, choosing ECDSA produced RSA keys and RSA signatures labelled "ecdsa".
        const { signature } = await bc.signFile(FILE, rsaKeys.privateKeyPem, 'sha256');
        const envelope = { v: 1, alg: 'ecdsa', hash: 'sha256', sig: signature };
        const result = await bc.verifySignature(FILE, envelope.sig, rsaKeys.publicKeyPem, envelope.hash);
        assert.deepEqual(plain(result), { alg: 'rsa', valid: true });
    });
});

describe('fingerprints and the server', () => {
    it('fingerprint derived from the private key matches the server\'s, for both key types', async () => {
        for (const keys of [rsaKeys, ...Object.values(ecKeys)]) {
            assert.equal(await bc.fingerprintFromPrivateKeyPem(keys.privateKeyPem), fingerprintFromPem(keys.publicKeyPem));
        }
    });

    it('fingerprintFromPublicKeyPem and digestHex match the server and OpenSSL', async () => {
        for (const keys of [rsaKeys, ...Object.values(ecKeys)]) {
            assert.equal(await bc.fingerprintFromPublicKeyPem(keys.publicKeyPem), fingerprintFromPem(keys.publicKeyPem));
        }
        for (const hash of ['sha256', 'sha384', 'sha512']) {
            assert.equal(await bc.digestHex(FILE, hash), nodeCrypto.createHash(hash).update(Buffer.from(FILE)).digest('hex'));
        }
    });

    it('the server registers ECDSA public keys and logs ECDSA signing events', async () => {
        const { client } = await registeredClient('ec');
        for (const keys of Object.values(ecKeys)) {
            const reg = await client.post('/api/keys', { label: 'EC key', publicKeyPem: keys.publicKeyPem });
            assert.equal(reg.status, 201);
            assert.equal(reg.body.key.fingerprint, await bc.fingerprintFromPrivateKeyPem(keys.privateKeyPem));

            const log = await client.post('/api/signatures', {
                documentName: 'ec.txt',
                documentHash: await bc.digestHex(FILE, 'sha256'),
                publicKeyFingerprint: reg.body.key.fingerprint,
            });
            assert.equal(log.status, 201);
        }
        assert.equal(await bc.digestHex(FILE, 'sha256'), sha256Hex('The quick brown fox signs the contract.'));
    });
});
