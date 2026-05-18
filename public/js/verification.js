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
const verifyHashSelect = document.getElementById('verifyHash');
const verifySigAlgSelect = document.getElementById('verifySigAlg');
const verifyAlgoNote = document.getElementById('verifyAlgoNote');
const signatureFileInput = document.getElementById('signatureFile');

// PEM of the public key chosen via lookup. Takes precedence over the file input if set.
let lookedUpPublicKeyPem = null;

// Accepts either the v1 JSON envelope { v, alg, hash, sig } or a legacy raw-base64
// signature. For legacy files, alg/hash are null and the caller falls back to the
// verifier's current settings (preserves pre-envelope behavior).
function parseSignatureFile(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj.sig === 'string') {
                return {
                    sig: obj.sig,
                    alg: typeof obj.alg === 'string' ? obj.alg : null,
                    hash: typeof obj.hash === 'string' ? obj.hash : null,
                };
            }
        } catch (_) {
            // fall through to legacy
        }
    }
    return { sig: trimmed, alg: null, hash: null };
}

// When the user picks a .sig file, auto-detect its algorithm from the envelope
// (if present) and reflect it in the verify-only dropdowns. The dropdowns
// drive verification regardless of appSettings, so the verifier never has to
// change their own account settings to verify someone else's signature.
async function onSignatureFilePicked() {
    const file = signatureFileInput.files[0];
    if (!file) {
        verifyHashSelect.disabled = false;
        verifySigAlgSelect.disabled = false;
        verifyAlgoNote.textContent = 'Pick a signature file to auto-detect, or set manually for legacy files. Your account settings are not affected.';
        verifyAlgoNote.className = 'verify-algo-note';
        return;
    }
    try {
        const text = await readFileAsText(file);
        const parsed = parseSignatureFile(text);
        if (parsed.alg && parsed.hash) {
            verifyHashSelect.value = parsed.hash;
            verifySigAlgSelect.value = parsed.alg;
            verifyHashSelect.disabled = true;
            verifySigAlgSelect.disabled = true;
            verifyAlgoNote.textContent = `Auto-detected from signature file: ${parsed.alg.toUpperCase()} with ${parsed.hash.toUpperCase()}.`;
            verifyAlgoNote.className = 'verify-algo-note detected';
        } else {
            verifyHashSelect.disabled = false;
            verifySigAlgSelect.disabled = false;
            verifyAlgoNote.textContent = 'Legacy signature file (no embedded algorithm). Choose the algorithm and hash the signer used.';
            verifyAlgoNote.className = 'verify-algo-note legacy';
        }
    } catch (e) {
        verifyHashSelect.disabled = false;
        verifySigAlgSelect.disabled = false;
        verifyAlgoNote.textContent = 'Could not read signature file. Choose the algorithm manually.';
        verifyAlgoNote.className = 'verify-algo-note legacy';
    }
}

signatureFileInput.addEventListener('change', onSignatureFilePicked);

// Clears verification-page inputs and any in-memory state from the previous
// session. Called on logout so a new user never sees the previous user's
// selected files, looked-up key, or stale verification result.
window.resetVerificationForm = function() {
    lookedUpPublicKeyPem = null;

    const fileToVerify = document.getElementById('fileToVerify');
    const signatureFile = document.getElementById('signatureFile');
    const publicKey = document.getElementById('publicKey');
    if (fileToVerify) fileToVerify.value = '';
    if (signatureFile) signatureFile.value = '';
    if (publicKey) publicKey.value = '';

    const resets = [
        ['#fileToVerifyWrapper .file-text', 'Choose the file to verify...'],
        ['#signatureFileWrapper .file-text', 'Choose the signature file (.sig)...'],
        ['#publicKeyWrapper .file-text', 'Choose the public key file...'],
    ];
    for (const [sel, placeholder] of resets) {
        const el = document.querySelector(sel);
        if (el) {
            el.textContent = placeholder;
            el.classList.remove('selected-file');
        }
    }

    if (lookupQuery) lookupQuery.value = '';
    if (lookupMode) lookupMode.value = 'username';
    if (lookupResult) {
        lookupResult.className = 'key-lookup-result';
        lookupResult.textContent = '';
    }

    verificationResult.classList.remove('show', 'valid', 'invalid');
    verifyingProgress.classList.remove('show');

    // Reset the verify-only algorithm picker back to defaults and unlocked.
    verifyHashSelect.value = 'sha256';
    verifySigAlgSelect.value = 'rsa';
    verifyHashSelect.disabled = false;
    verifySigAlgSelect.disabled = false;
    verifyAlgoNote.textContent = 'Pick a signature file to auto-detect, or set manually for legacy files. Your account settings are not affected.';
    verifyAlgoNote.className = 'verify-algo-note';
};

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
        const sigFileText = await readFileAsText(sigInput.files[0]);
        // Prefer the looked-up key over the file input if the user picked one.
        const publicKeyPem = lookedUpPublicKeyPem || await readFileAsText(pubKeyInput.files[0]);

        // Parse the signature envelope to get the raw signature bytes. The
        // algorithm and hash come from the verify-page dropdowns, which were
        // auto-populated from the envelope (locked) or filled by the user
        // for legacy files. appSettings is never consulted here — verifying
        // someone else's signature does not depend on the verifier's settings.
        const parsed = parseSignatureFile(sigFileText);
        const hashAlg = verifyHashSelect.value;
        const sigAlg = verifySigAlgSelect.value;

        const isValid = await verifySignature(
            fileData,
            parsed.sig,
            publicKeyPem,
            hashAlg,
            sigAlg
        );

        verifyingProgress.classList.remove('show');
        verificationResult.classList.add('show');

        const usedDetail = ` (${sigAlg.toUpperCase()} / ${hashAlg.toUpperCase()})`;
        if (isValid) {
            verificationResult.classList.add('valid');
            verificationResult.classList.remove('invalid');
            resultStatus.textContent = 'VALID';
            resultMessage.textContent = 'The file is authentic and has not been modified' + usedDetail;
        } else {
            verificationResult.classList.add('invalid');
            verificationResult.classList.remove('valid');
            resultStatus.textContent = 'INVALID';
            resultMessage.textContent = 'The signature does not match or the file has been tampered with' + usedDetail;
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