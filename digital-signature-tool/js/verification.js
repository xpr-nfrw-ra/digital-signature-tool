// verification.js - Signature verification functionality

// DOM elements
const verifyButton = document.getElementById('verifyButton');
const verifyingProgress = document.getElementById('verifyingProgress');
const verificationResult = document.getElementById('verificationResult');
const resultStatus = document.getElementById('resultStatus');
const resultMessage = document.getElementById('resultMessage');

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
    
    if (!pubKeyInput.files[0]) {
        alert('Please select a public key');
        return;
    }

    try {
        verifyButton.disabled = true;
        verifyingProgress.classList.add('show');
        verificationResult.classList.remove('show');

        // Read all files
        const fileData = await readFileAsArrayBuffer(fileInput.files[0]);
        const signatureBase64 = await readFileAsText(sigInput.files[0]);
        const publicKeyPem = await readFileAsText(pubKeyInput.files[0]);
        
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