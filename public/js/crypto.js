// crypto.js - Core cryptographic functions

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

// SHA-256 fingerprint of a public key (DER-encoded SubjectPublicKeyInfo), as hex.
// Matches the server-side fingerprint computed by Node's crypto module.
function fingerprintFromPublicKey(publicKey) {
    const asn1 = forge.pki.publicKeyToAsn1(publicKey);
    const derBytes = forge.asn1.toDer(asn1).getBytes();
    const md = forge.md.sha256.create();
    md.update(derBytes);
    return md.digest().toHex();
}

// Derive the matching public-key fingerprint from a private-key PEM (RSA only).
function fingerprintFromPrivateKeyPem(privateKeyPem) {
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
    return fingerprintFromPublicKey(publicKey);
}

// Hex digest of file content using the chosen hash algorithm.
function hashFileHex(fileData, hashAlgorithm) {
    const md = forge.md[hashAlgorithm].create();
    md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
    return md.digest().toHex();
}

// Generate RSA key pair
async function generateRSAKeyPair(keySize) {
    return new Promise((resolve, reject) => {
        forge.pki.rsa.generateKeyPair({ bits: parseInt(keySize), workers: 2 }, (err, keypair) => {
            if (err) reject(err);
            else resolve(keypair);
        });
    });
}

// Generate ECDSA key pair
async function generateECDSAKeyPair(curveName) {
    return new Promise((resolve, reject) => {
        try {
            // Map curve size to RSA equivalent for demonstration
            // Note: forge.js has limited ECDSA support, so we use RSA as workaround
            // For production, use Web Crypto API for proper ECDSA
            const keyBitsMap = {
                '256': 2048,
                '384': 3072,
                '521': 4096
            };
            
            const rsaBits = keyBitsMap[curveName] || 2048;
            
            // Generate RSA key pair as ECDSA substitute
            forge.pki.rsa.generateKeyPair({ bits: rsaBits, workers: 2 }, (err, keypair) => {
                if (err) reject(err);
                else resolve(keypair);
            });
        } catch (err) {
            reject(err);
        }
    });
}

// Main key generation function
async function generateKeyPair(keySize, algorithm) {
    if (algorithm === 'rsa') {
        return await generateRSAKeyPair(keySize);
    } else if (algorithm === 'ecdsa') {
        return await generateECDSAKeyPair(keySize);
    } else {
        throw new Error('Unsupported algorithm: ' + algorithm);
    }
}

// Sign file data with RSA
async function signFileRSA(fileData, privateKeyPem, hashAlgorithm) {
    try {
        // Parse private key
        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        
        // Create hash
        const md = forge.md[hashAlgorithm].create();
        md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
        
        // Sign the hash
        const signature = privateKey.sign(md);
        
        // Return base64 encoded signature
        return forge.util.encode64(signature);
    } catch (error) {
        throw new Error('Failed to sign file with RSA: ' + error.message);
    }
}

// Sign file data with ECDSA
async function signFileECDSA(fileData, privateKeyPem, hashAlgorithm) {
    try {
        // For ECDSA, we use the same approach as RSA in forge.js
        // Note: This is a simplified implementation
        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        
        const md = forge.md[hashAlgorithm].create();
        md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
        
        const signature = privateKey.sign(md);
        
        return forge.util.encode64(signature);
    } catch (error) {
        throw new Error('Failed to sign file with ECDSA: ' + error.message);
    }
}

// Main signing function
async function signFile(fileData, privateKeyPem, hashAlgorithm, algorithm) {
    if (algorithm === 'rsa') {
        return await signFileRSA(fileData, privateKeyPem, hashAlgorithm);
    } else if (algorithm === 'ecdsa') {
        return await signFileECDSA(fileData, privateKeyPem, hashAlgorithm);
    } else {
        throw new Error('Unsupported algorithm: ' + algorithm);
    }
}

// Verify signature with RSA.
// Treats any internal forge error (mismatched modulus size, malformed signature
// bytes, hash/key size mismatch, etc.) as a verification failure — i.e. returns
// false rather than throwing. The caller renders this as INVALID, which matches
// the user's mental model: a signature that can't be matched against this file
// + key is not valid, regardless of *why*. Only PEM parse errors throw, since
// those mean the public key itself is unusable.
async function verifySignatureRSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    try {
        const md = forge.md[hashAlgorithm].create();
        md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
        const signature = forge.util.decode64(signatureBase64);
        return publicKey.verify(md.digest().bytes(), signature);
    } catch (error) {
        return false;
    }
}

// Verify signature with ECDSA. Same failure semantics as RSA above.
async function verifySignatureECDSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    try {
        const md = forge.md[hashAlgorithm].create();
        md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
        const signature = forge.util.decode64(signatureBase64);
        return publicKey.verify(md.digest().bytes(), signature);
    } catch (error) {
        return false;
    }
}

// Main verification function
async function verifySignature(fileData, signatureBase64, publicKeyPem, hashAlgorithm, algorithm) {
    if (algorithm === 'rsa') {
        return await verifySignatureRSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm);
    } else if (algorithm === 'ecdsa') {
        return await verifySignatureECDSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm);
    } else {
        throw new Error('Unsupported algorithm: ' + algorithm);
    }
}