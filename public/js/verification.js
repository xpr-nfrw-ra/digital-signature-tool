// verification.js - Signature verification functionality

// DOM elements
const verifyButton = document.getElementById('verifyButton');
const verifyingProgress = document.getElementById('verifyingProgress');
const verificationResult = document.getElementById('verificationResult');
const resultStatus = document.getElementById('resultStatus');
const resultMessage = document.getElementById('resultMessage');
const lookupMode = document.getElementById('lookupMode');
const lookupQuery = document.getElementById('lookupQuery');
const lookupButton = document.getElementById('lookupButton');
const lookupResult = document.getElementById('lookupResult');

// PEM of the public key chosen via lookup. Takes precedence over the file input if set.
let lookedUpPublicKeyPem = null;

function setLookupMessage(text, cls) {
    lookupResult.className = 'key-lookup-result' + (cls ? ' ' + cls : '');
    lookupResult.textContent = text;
}

function shortFp(fp) { return fp.slice(0, 16) + '…'; }

function renderKeyChoices(keys) {
    lookedUpPublicKeyPem = null;
    if (!keys || keys.length === 0) {
        setLookupMessage('No public keys found.', 'error');
        return;
    }
    lookupResult.className = 'key-lookup-result';
    lookupResult.innerHTML = '<div>Select a key:</div>';
    const ul = document.createElement('ul');
    keys.forEach(k => {
        const li = document.createElement('li');
        li.textContent = `${k.label}  ·  ${shortFp(k.fingerprint)}`;
        li.addEventListener('click', () => {
            ul.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');
            lookedUpPublicKeyPem = k.publicKeyPem;
            setLookupMessage(`Selected key "${k.label}" (${shortFp(k.fingerprint)}). Click Verify to use it.`, 'ok');
        });
        ul.appendChild(li);
    });
    lookupResult.appendChild(ul);
}

lookupButton.addEventListener('click', async () => {
    const q = lookupQuery.value.trim();
    if (!q) {
        setLookupMessage('Enter a username or fingerprint.', 'error');
        return;
    }
    lookupButton.disabled = true;
    setLookupMessage('Looking up…');
    try {
        if (lookupMode.value === 'username') {
            const res = await fetch('/api/keys/by-username/' + encodeURIComponent(q));
            if (res.status === 401) { setLookupMessage('Sign in to use key lookup.', 'error'); return; }
            const data = await res.json();
            renderKeyChoices(data.keys || []);
        } else {
            const res = await fetch('/api/keys/by-fingerprint/' + encodeURIComponent(q.toLowerCase()));
            if (res.status === 401) { setLookupMessage('Sign in to use key lookup.', 'error'); return; }
            if (res.status === 404) { setLookupMessage('No key with that fingerprint.', 'error'); return; }
            const data = await res.json();
            renderKeyChoices(data.key ? [data.key] : []);
        }
    } catch (e) {
        setLookupMessage('Lookup failed: ' + e.message, 'error');
    } finally {
        lookupButton.disabled = false;
    }
});

// Verify signature button handler
verifyButton.addEventListener('click', async () => {
    const fileInput = document.getElementById('fileToVerify');
    const sigInput = document.getElementById('signatureFile');
    const pubKeyInput = document.getElementById('publicKey');
    
    if (!fileInput.files[0]) {
        alert('Please select a file to verify');
        return;
    }
    
    if (!sigInput.files[0]) {
        alert('Please select a signature file');
        return;
    }
    
    if (!pubKeyInput.files[0] && !lookedUpPublicKeyPem) {
        alert('Please select a public key file or look up a stored key');
        return;
    }

    try {
        verifyButton.disabled = true;
        verifyingProgress.classList.add('show');
        verificationResult.classList.remove('show');

        // Read all files
        const fileData = await readFileAsArrayBuffer(fileInput.files[0]);
        const signatureBase64 = await readFileAsText(sigInput.files[0]);
        // Prefer the looked-up key over the file input if the user picked one.
        const publicKeyPem = lookedUpPublicKeyPem || await readFileAsText(pubKeyInput.files[0]);
        
        // Verify the signature with selected algorithm
        const isValid = await verifySignature(
            fileData, 
            signatureBase64, 
            publicKeyPem, 
            appSettings.hashAlgorithm,
            appSettings.signatureAlgorithm
        );
        
        verifyingProgress.classList.remove('show');
        verificationResult.classList.add('show');
        
        if (isValid) {
            verificationResult.classList.add('valid');
            verificationResult.classList.remove('invalid');
            resultStatus.textContent = 'VALID';
            resultMessage.textContent = 'The file is authentic and has not been modified';
        } else {
            verificationResult.classList.add('invalid');
            verificationResult.classList.remove('valid');
            resultStatus.textContent = 'INVALID';
            resultMessage.textContent = 'The signature does not match or the file has been tampered with';
        }
        
    } catch (error) {
        verifyingProgress.classList.remove('show');
        verificationResult.classList.add('show', 'invalid');
        verificationResult.classList.remove('valid');
        resultStatus.textContent = 'ERROR';
        resultMessage.textContent = 'Verification failed: ' + error.message;
    } finally {
        verifyButton.disabled = false;
    }
});