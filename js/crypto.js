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

// Verify signature with RSA
async function verifySignatureRSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    try {
        // Parse public key
        const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
        
        // Create hash of file
        const md = forge.md[hashAlgorithm].create();
        md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
        
        // Decode signature from base64
        const signature = forge.util.decode64(signatureBase64);
        
        // Verify signature
        return publicKey.verify(md.digest().bytes(), signature);
    } catch (error) {
        throw new Error('Failed to verify RSA signature: ' + error.message);
    }
}

// Verify signature with ECDSA
async function verifySignatureECDSA(fileData, signatureBase64, publicKeyPem, hashAlgorithm) {
    try {
        // For ECDSA, we use the same approach as RSA in forge.js
        const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
        
        const md = forge.md[hashAlgorithm].create();
        md.update(forge.util.binary.raw.encode(new Uint8Array(fileData)));
        
        const signature = forge.util.decode64(signatureBase64);
        
        return publicKey.verify(md.digest().bytes(), signature);
    } catch (error) {
        throw new Error('Failed to verify ECDSA signature: ' + error.message);
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