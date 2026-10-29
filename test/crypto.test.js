// Tests the browser crypto code (public/js/crypto.js) by running it, together with the
// bundled forge.min.js, in a sandbox that provides the browser globals it needs.
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
    // Share the host's binary types: forge checks `instanceof ArrayBuffer` on Web Crypto
    // output, which fails across realms (in a browser there is only one realm).
    const sandbox = {
        crypto: globalThis.crypto, atob, btoa, setTimeout, clearTimeout, console,
        ArrayBuffer, Uint8Array, DataView, TextEncoder,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    for (const file of ['public/lib/forge.min.js', 'public/js/crypto.js']) {
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

describe('RSA and legacy signatures', () => {
    it('RSA sign/verify is unchanged and OpenSSL-compatible', async () => {
        const { signature } = await bc.signFile(FILE, rsaKeys.privateKeyPem, 'sha256');
        assert.deepEqual(plain(await bc.verifySignature(FILE, signature, rsaKeys.publicKeyPem, 'sha256')), { alg: 'rsa', valid: true });
        assert.ok(nodeCrypto.verify('sha256', Buffer.from(FILE), rsaKeys.publicKeyPem, Buffer.from(signature, 'base64')));
    });

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

    it('fingerprintFromPublicKeyPem and digestHex match the server and forge', async () => {
        for (const keys of [rsaKeys, ...Object.values(ecKeys)]) {
            assert.equal(await bc.fingerprintFromPublicKeyPem(keys.publicKeyPem), fingerprintFromPem(keys.publicKeyPem));
        }
        for (const hash of ['sha256', 'sha384', 'sha512']) {
            assert.equal(await bc.digestHex(FILE, hash), bc.hashFileHex(FILE, hash));
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
                documentHash: bc.hashFileHex(FILE, 'sha256'),
                publicKeyFingerprint: reg.body.key.fingerprint,
            });
            assert.equal(log.status, 201);
        }
        assert.equal(bc.hashFileHex(FILE, 'sha256'), sha256Hex('The quick brown fox signs the contract.'));
    });
});
