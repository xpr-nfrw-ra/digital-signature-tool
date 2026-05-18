// signing.js - File signing functionality

let generatedPrivateKey = null;

// DOM elements
const signButton = document.getElementById('signButton');
const signingProgress = document.getElementById('signingProgress');
const generateKeyButton = document.getElementById('generateKeyButton');
const generateKeyModal = document.getElementById('generateKeyModal');
const cancelGenerate = document.getElementById('cancelGenerate');
const confirmGenerate = document.getElementById('confirmGenerate');
const closeSuccess = document.getElementById('closeSuccess');
const modalForm = document.getElementById('modalForm');
const modalSuccess = document.getElementById('modalSuccess');
const keygenProgress = document.getElementById('keygenProgress');

// Open key generation modal
generateKeyButton.addEventListener('click', () => {
    const algoNames = { 
        'rsa': 'RSA',
        'ecdsa': 'ECDSA'
    };
    const hashNames = {
        'sha256': 'SHA-256',
        'sha384': 'SHA-384',
        'sha512': 'SHA-512'
    };
    
    // Display key size with proper units
    let keySizeDisplay = appSettings.keySize + ' bits';
    if (appSettings.signatureAlgorithm === 'ecdsa') {
        const curveNames = {
            '2048': 'P-256',
            '3072': 'P-384',
            '4096': 'P-521'
        };
        keySizeDisplay = appSettings.keySize + ' bits (' + curveNames[appSettings.keySize] + ')';
    }
    
    document.getElementById('modalAlgorithm').textContent = algoNames[appSettings.signatureAlgorithm];
    document.getElementById('modalKeySize').textContent = keySizeDisplay;
    document.getElementById('modalHash').textContent = hashNames[appSettings.hashAlgorithm];
    
    modalForm.style.display = 'block';
    modalSuccess.classList.remove('active');
    keygenProgress.classList.remove('show');
    generateKeyModal.classList.add('active');
});

// Cancel key generation
cancelGenerate.addEventListener('click', () => {
    generateKeyModal.classList.remove('active');
    document.getElementById('keyName').value = '';
});

// Confirm key generation
confirmGenerate.addEventListener('click', async () => {
    const keyName = document.getElementById('keyName').value.trim();
    if (!keyName) {
        alert('Please enter a key name');
        return;
    }

    try {
        confirmGenerate.disabled = true;
        cancelGenerate.disabled = true;
        keygenProgress.classList.add('show');

        // Generate key pair with selected algorithm
        const keypair = await generateKeyPair(appSettings.keySize, appSettings.signatureAlgorithm);
        
        // Convert to PEM format
        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
        const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
        
        // Store private key for auto-fill
        generatedPrivateKey = privateKeyPem;
        
        // Download both keys
        downloadFile(privateKeyPem, `${keyName}_private.pem`, 'application/x-pem-file');
        downloadFile(publicKeyPem, `${keyName}_public.pem`, 'application/x-pem-file');
        
        // If logged in, upload the public half to the server. Guests skip this.
        let uploadInfo = '';
        if (currentUser) {
            try {
                const res = await fetch('/api/keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label: keyName, publicKeyPem }),
                });
                const data = await res.json();
                if (res.ok && data.key) {
                    const fp = data.key.fingerprint;
                    const short = fp.slice(0, 16);
                    uploadInfo = ` Public key registered (fingerprint ${short}…).`;
                } else {
                    uploadInfo = ` Note: server-side upload failed (${data.error || 'unknown error'}).`;
                }
            } catch (e) {
                uploadInfo = ' Note: server-side upload failed (network error).';
            }
        }

        // Show success message
        keygenProgress.classList.remove('show');
        modalForm.style.display = 'none';
        modalSuccess.classList.add('active');

        const algoName = appSettings.signatureAlgorithm.toUpperCase();
        document.getElementById('successMessage').textContent =
            `Your ${algoName} keys "${keyName}_private.pem" and "${keyName}_public.pem" have been downloaded.` + uploadInfo;
        
    } catch (error) {
        alert('Key generation failed: ' + error.message);
        keygenProgress.classList.remove('show');
    } finally {
        confirmGenerate.disabled = false;
        cancelGenerate.disabled = false;
    }
});

// Close success modal
closeSuccess.addEventListener('click', () => {
    generateKeyModal.classList.remove('active');
    document.getElementById('keyName').value = '';
    
    // Auto-fill private key if just generated
    if (generatedPrivateKey) {
        const privateKeyFile = new File(
            [generatedPrivateKey], 
            'generated_private.pem', 
            { type: 'application/x-pem-file' }
        );
        const dt = new DataTransfer();
        dt.items.add(privateKeyFile);
        document.getElementById('privateKey').files = dt.files;
        
        const textSpan = document.querySelector('#privateKeyWrapper .file-text');
        textSpan.textContent = 'generated_private.pem';
        textSpan.classList.add('selected-file');
        generatedPrivateKey = null;
    }
});

// Clears signing-page inputs and any in-memory state from the previous session.
// Called on logout so a new user never sees the previous user's selected file
// or in-memory generated private key.
window.resetSigningForm = function() {
    generatedPrivateKey = null;

    const fileToSign = document.getElementById('fileToSign');
    const privateKey = document.getElementById('privateKey');
    if (fileToSign) fileToSign.value = '';
    if (privateKey) privateKey.value = '';

    const fileToSignText = document.querySelector('#fileToSignWrapper .file-text');
    if (fileToSignText) {
        fileToSignText.textContent = 'Choose a file to sign...';
        fileToSignText.classList.remove('selected-file');
    }
    const privateKeyText = document.querySelector('#privateKeyWrapper .file-text');
    if (privateKeyText) {
        privateKeyText.textContent = 'Choose your private key file...';
        privateKeyText.classList.remove('selected-file');
    }

    signingProgress.classList.remove('show');
    generateKeyModal.classList.remove('active');
    modalSuccess.classList.remove('active');
    modalForm.style.display = 'block';
    const keyNameInput = document.getElementById('keyName');
    if (keyNameInput) keyNameInput.value = '';
};

// Close modal on overlay click
generateKeyModal.addEventListener('click', (e) => {
    if (e.target === generateKeyModal) {
        generateKeyModal.classList.remove('active');
        document.getElementById('keyName').value = '';
    }
});

// Sign file button handler
signButton.addEventListener('click', async () => {
    const fileInput = document.getElementById('fileToSign');
    const keyInput = document.getElementById('privateKey');
    
    if (!fileInput.files[0]) {
        alert('Please select a file to sign');
        return;
    }
    
    if (!keyInput.files[0] && !generatedPrivateKey) {
        alert('Please select a private key or generate one');
        return;
    }

    try {
        signButton.disabled = true;
        signingProgress.classList.add('show');

        // Read file data
        const fileData = await readFileAsArrayBuffer(fileInput.files[0]);
        
        // Read or use generated private key
        const privateKeyPem = generatedPrivateKey || await readFileAsText(keyInput.files[0]);
        
        // Sign the file with selected algorithm
        const signature = await signFile(
            fileData,
            privateKeyPem,
            appSettings.hashAlgorithm,
            appSettings.signatureAlgorithm
        );

        // Wrap in a self-describing envelope so the verifier knows which algorithm
        // and hash to use — without this, verification depends on the verifier's
        // current settings and breaks for anyone but the signer.
        const sigEnvelope = JSON.stringify({
            v: 1,
            alg: appSettings.signatureAlgorithm,
            hash: appSettings.hashAlgorithm,
            sig: signature,
        });

        // Download signature file
        const originalFileName = fileInput.files[0].name;
        downloadFile(sigEnvelope, `${originalFileName}.sig`, 'application/json');

        // Log the signing event on the server (auth required; non-fatal on failure).
        let logNote = '';
        if (currentUser) {
            try {
                const documentHash = hashFileHex(fileData, appSettings.hashAlgorithm);
                const publicKeyFingerprint = fingerprintFromPrivateKeyPem(privateKeyPem);
                const res = await fetch('/api/signatures', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        documentName: originalFileName,
                        documentHash,
                        publicKeyFingerprint,
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    logNote = `\n(Note: signing not logged — ${data.error || 'server error'}.)`;
                }
            } catch (e) {
                logNote = '\n(Note: signing not logged — network error.)';
            }
        }

        signingProgress.classList.remove('show');
        const algoName = appSettings.signatureAlgorithm.toUpperCase();
        alert(`File signed successfully with ${algoName}! Signature file downloaded.` + logNote);
        
    } catch (error) {
        signingProgress.classList.remove('show');
        alert('Signing failed: ' + error.message);
    } finally {
        signButton.disabled = false;
    }
});