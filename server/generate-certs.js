// generate-certs.js - Generate self-signed SSL certificates using node-forge
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const certsDir = path.join(__dirname, '..', 'certs');

// Ensure certs directory exists
if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
}

const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('Certificates already exist in certs/. Delete them to regenerate.');
    process.exit(0);
}

console.log('Generating RSA 2048-bit key pair...');
const keys = forge.pki.rsa.generateKeyPair(2048);

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
    { name: 'commonName', value: 'signtool.local' },
    { name: 'organizationName', value: 'Digital Signature Tool (Dev)' }
];
cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
    { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 2, value: 'signtool.local' },
        { type: 7, ip: '127.0.0.1' }
    ]}
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
const pemCert = forge.pki.certificateToPem(cert);

fs.writeFileSync(keyPath, pemKey);
fs.writeFileSync(certPath, pemCert);

console.log('Self-signed certificates generated:');
console.log('  ' + keyPath);
console.log('  ' + certPath);
console.log('Valid for 1 year.');
