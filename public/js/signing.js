// signing.js - File signing functionality

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
    
    // Display key size with proper units (ECDSA: the curve this size tier maps to)
    const keySizeDisplay = appSettings.signatureAlgorithm === 'ecdsa'
        ? ECDSA_CURVES[appSettings.keySize] + ' curve'
        : appSettings.keySize + ' bits';
    
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

// Puts a key into the "Private Key" file field, exactly as if the user had picked it.
// Signing always reads that field, so what it shows is what gets used.
function setPrivateKeyField(privateKeyPem, fileName) {
    const dt = new DataTransfer();
    dt.items.add(new File([privateKeyPem], fileName, { type: 'application/x-pem-file' }));
    document.getElementById('privateKey').files = dt.files;
    const textSpan = document.querySelector('#privateKeyWrapper .file-text');
    textSpan.textContent = fileName;
    textSpan.classList.add('selected-file');
}

// Key names become file names and the key's label on the server (1-64 characters).
const KEY_NAME_MAX = 64;

// Confirm key generation
confirmGenerate.addEventListener('click', async () => {
    const keyName = document.getElementById('keyName').value.trim();
    if (!keyName) {
        alert('Please enter a key name');
        return;
    }
    if (keyName.length > KEY_NAME_MAX) {
        alert(`The key name can be at most ${KEY_NAME_MAX} characters.`);
        return;
    }
    if (/[\x00-\x1F\x7F]/.test(keyName)) {
        alert('The key name cannot contain control characters.');
        return;
    }

    try {
        confirmGenerate.disabled = true;
        cancelGenerate.disabled = true;
        keygenProgress.classList.add('show');

        // Generate key pair (PEM) with selected algorithm
        const { privateKeyPem, publicKeyPem } = await generateKeyPair(appSettings.keySize, appSettings.signatureAlgorithm);

        // Select the new private key for signing straight away, however the dialog is closed.
        setPrivateKeyField(privateKeyPem, `${keyName}_private.pem`);

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
});

// Clears signing-page inputs and any in-memory state from the previous session.
// Called on logout so a new user never sees the previous user's selected file
// or freshly generated private key.
window.resetSigningForm = function() {
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
    
    if (!keyInput.files[0]) {
        alert('Please select a private key or generate one');
        return;
    }

    try {
        signButton.disabled = true;
        signingProgress.classList.add('show');

        // Read file data
        const fileData = await readFileAsArrayBuffer(fileInput.files[0]);
        
        const privateKeyPem = await readFileAsText(keyInput.files[0]);
        
        // Sign the file. The algorithm comes from the key itself (an RSA key always
        // signs with RSA, an EC key with ECDSA), whatever the settings say.
        const { alg, signature } = await signFile(fileData, privateKeyPem, appSettings.hashAlgorithm);

        // Wrap in a self-describing envelope so the verifier knows which algorithm
        // and hash to use — without this, verification depends on the verifier's
        // current settings and breaks for anyone but the signer.
        const sigEnvelope = JSON.stringify({
            v: 1,
            alg,
            hash: appSettings.hashAlgorithm,
            sig: signature,
        });

        // Download signature file
        const originalFileName = fileInput.files[0].name;
        downloadFile(sigEnvelope, `${originalFileName}.sig`, 'application/json');

        // Log the signing event on the server (auth required; non-fatal on failure).
        let logNote = '';
        if (currentUser) {
            const notLogged = reason => `\n(Note: signing not logged — ${String(reason).replace(/\.+$/, '')}.)`;
            let entry = null;
            try {
                entry = {
                    documentName: originalFileName,
                    documentHash: await digestHex(fileData, appSettings.hashAlgorithm),
                    publicKeyFingerprint: await fingerprintFromPrivateKeyPem(privateKeyPem),
                };
            } catch (e) {
                logNote = notLogged(e.message);
            }
            if (entry) {
                try {
                    const res = await fetch('/api/signatures', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(entry),
                    });
                    if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        logNote = notLogged(data.error || 'server error');
                    }
                } catch (e) {
                    logNote = notLogged('network error');
                }
            }
        }

        signingProgress.classList.remove('show');
        const keyNote = alg !== appSettings.signatureAlgorithm
            ? `\n(Your settings say ${appSettings.signatureAlgorithm.toUpperCase()}, but this is an ${alg.toUpperCase()} key, so it signed with ${alg.toUpperCase()}.)`
            : '';
        alert(`File signed successfully with ${alg.toUpperCase()}! Signature file downloaded.` + keyNote + logNote);
        
    } catch (error) {
        signingProgress.classList.remove('show');
        alert('Signing failed: ' + error.message);
    } finally {
        signButton.disabled = false;
    }
});