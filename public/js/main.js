// main.js - Main application logic, navigation, and settings

// Global app settings
let appSettings = {
    hashAlgorithm: 'sha256',
    signatureAlgorithm: 'rsa',
    keySize: '2048'
};

// ===== NAVIGATION =====
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.content-section');
const headerTitle = document.getElementById('headerTitle');
const headerSubtitle = document.getElementById('headerSubtitle');

const sectionConfig = {
    signing: {
        title: 'File Signing',
        subtitle: 'Create a digital signature for your file'
    },
    verification: {
        title: 'Signature Verification',
        subtitle: 'Verify the authenticity of a signed file'
    },
    settings: {
        title: 'Settings',
        subtitle: 'Configure cryptographic algorithms'
    }
};

navItems.forEach(item => {
    item.addEventListener('click', function() {
        const sectionId = this.getAttribute('data-section');
        
        // Update active nav item
        navItems.forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');
        
        // Update content sections
        sections.forEach(section => section.classList.remove('active'));
        document.getElementById(sectionId + '-section').classList.add('active');
        
        // Update header
        headerTitle.textContent = sectionConfig[sectionId].title;
        headerSubtitle.textContent = sectionConfig[sectionId].subtitle;
    });
});

// ===== FILE INPUT HANDLERS =====
document.querySelectorAll('.file-input-wrapper').forEach(wrapper => {
    wrapper.addEventListener('click', function() {
        this.querySelector('input[type="file"]').click();
    });
    
    wrapper.querySelector('input[type="file"]').addEventListener('change', function(e) {
        const fileName = e.target.files[0]?.name || 'Choose a file...';
        const textSpan = wrapper.querySelector('.file-text');
        textSpan.textContent = fileName;
        if (e.target.files[0]) {
            textSpan.classList.add('selected-file');
        } else {
            textSpan.classList.remove('selected-file');
        }
    });
});

// ===== SETTINGS =====
const hashAlgorithm = document.getElementById('hashAlgorithm');
const signatureAlgorithm = document.getElementById('signatureAlgorithm');
const keySize = document.getElementById('keySize');

// The key-size setting is stored as an RSA bit size; for ECDSA each option stands for
// a curve (see ECDSA_CURVES in crypto.js), so relabel the options to match.
function updateKeySizeLabels() {
    for (const option of keySize.options) {
        option.textContent = signatureAlgorithm.value === 'ecdsa'
            ? ECDSA_CURVES[option.value]
            : option.value + ' bits';
    }
}

function applySettingsToUI(s) {
    appSettings.hashAlgorithm = s.hashAlgorithm;
    appSettings.signatureAlgorithm = s.signatureAlgorithm;
    appSettings.keySize = String(s.keySize);
    appSettings.defaultPublicKeyId = s.defaultPublicKeyId ?? null;
    hashAlgorithm.value = s.hashAlgorithm;
    signatureAlgorithm.value = s.signatureAlgorithm;
    keySize.value = String(s.keySize);
    updateKeySizeLabels();
}

async function loadSettingsFromServer() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) return; // guest or not logged in
        const { settings } = await res.json();
        applySettingsToUI(settings);
        if (typeof window.loadMyKeys === 'function') {
            window.loadMyKeys();
        }
    } catch (e) {
        // server unreachable — keep client defaults
    }
}

// Persist a single field. Guest users (no session) silently get a 401 and we ignore it.
async function persistSetting(patch) {
    try {
        await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
    } catch (e) {
        // network error — settings will be re-saved on next change
    }
}

hashAlgorithm.addEventListener('change', (e) => {
    appSettings.hashAlgorithm = e.target.value;
    persistSetting({ hashAlgorithm: e.target.value });
});

signatureAlgorithm.addEventListener('change', (e) => {
    appSettings.signatureAlgorithm = e.target.value;
    updateKeySizeLabels();
    persistSetting({ signatureAlgorithm: e.target.value });
});

keySize.addEventListener('change', (e) => {
    appSettings.keySize = e.target.value;
    persistSetting({ keySize: Number(e.target.value) });
});

// Expose for auth.js to call after successful login.
window.loadSettingsFromServer = loadSettingsFromServer;

// Resets the Settings dropdowns and in-memory appSettings back to defaults on
// logout. The server-side row is untouched — it will be re-fetched on next login.
window.applyDefaultSettings = function() {
    applySettingsToUI({
        hashAlgorithm: 'sha256',
        signatureAlgorithm: 'rsa',
        keySize: 2048,
        defaultPublicKeyId: null,
    });
};

// ===== MY KEYS (preferred public key) =====
const myKeysList = document.getElementById('myKeysList');
const myKeysStatus = document.getElementById('myKeysStatus');

function shortFp(fp) {
    return fp.length > 16 ? `${fp.slice(0, 8)}…${fp.slice(-8)}` : fp;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function renderMyKeys(keys, preferredId) {
    myKeysList.innerHTML = '';
    if (!keys.length) {
        myKeysStatus.textContent = 'You have no registered public keys yet. Generate one from the File Signing page.';
        myKeysStatus.style.display = 'block';
        return;
    }
    myKeysStatus.style.display = 'none';

    const items = [{ id: null, label: '(no preferred key)', fingerprint: '' }, ...keys];
    for (const k of items) {
        const li = document.createElement('li');
        li.className = 'my-keys-item';
        const isPreferred = (k.id === preferredId) || (k.id === null && preferredId == null);
        const inputId = k.id == null ? 'pref-key-none' : `pref-key-${k.id}`;
        li.innerHTML = `
            <label for="${inputId}" class="my-keys-row">
                <input type="radio" name="preferredKey" id="${inputId}" value="${k.id == null ? '' : k.id}" ${isPreferred ? 'checked' : ''} />
                <span class="my-keys-label">${escapeHtml(k.label)}</span>
                ${k.fingerprint ? `<span class="my-keys-fp" title="${escapeHtml(k.fingerprint)}">${shortFp(k.fingerprint)}</span>` : ''}
            </label>
        `;
        myKeysList.appendChild(li);
    }

    myKeysList.querySelectorAll('input[name="preferredKey"]').forEach(input => {
        input.addEventListener('change', async () => {
            const raw = input.value;
            const newId = raw === '' ? null : Number(raw);
            const prev = appSettings.defaultPublicKeyId;
            appSettings.defaultPublicKeyId = newId;
            try {
                const res = await fetch('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ defaultPublicKeyId: newId }),
                });
                if (!res.ok) throw new Error('save failed');
            } catch (e) {
                appSettings.defaultPublicKeyId = prev;
                renderMyKeys(keys, prev);
            }
        });
    });
}

async function loadMyKeys() {
    if (!myKeysList) return;
    try {
        const res = await fetch('/api/keys/mine');
        if (!res.ok) {
            myKeysStatus.textContent = 'Log in to manage your preferred signing key.';
            myKeysList.innerHTML = '';
            return;
        }
        const { keys } = await res.json();
        renderMyKeys(keys, appSettings.defaultPublicKeyId ?? null);
    } catch (e) {
        myKeysStatus.textContent = 'Could not load your keys.';
        myKeysList.innerHTML = '';
    }
}

// ===== SIGNING HISTORY =====
const historyList = document.getElementById('historyList');
const historyStatus = document.getElementById('historyStatus');
const historyMore = document.getElementById('historyMore');
const HISTORY_PAGE_SIZE = 20;
let historyCursor = null;

// The stored hash's length tells which algorithm the signer used.
const HASH_NAME_BY_HEX_LENGTH = { 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512' };

function historyItem(entry) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const name = document.createElement('span');
    name.className = 'history-main';
    name.textContent = entry.documentName;
    name.title = entry.documentHash;
    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = [
        new Date(entry.signedAt).toLocaleString(),
        `${entry.publicKey.label} (${shortFp(entry.publicKey.fingerprint)})`,
        HASH_NAME_BY_HEX_LENGTH[entry.documentHash.length] || '',
    ].filter(Boolean).join('  ·  ');
    li.append(name, meta);
    return li;
}

function setHistoryStatus(text) {
    historyStatus.textContent = text;
    historyStatus.style.display = text ? 'block' : 'none';
}

// Loads the first page (reset) or the next page of the caller's signing history.
async function loadSigningHistory(reset = true) {
    if (reset) {
        historyCursor = null;
        historyList.replaceChildren();
        historyMore.style.display = 'none';
        setHistoryStatus('Loading your history…');
    }
    historyMore.disabled = true;
    try {
        const qs = `limit=${HISTORY_PAGE_SIZE}` + (historyCursor ? `&cursor=${historyCursor}` : '');
        const res = await fetch('/api/signatures/mine?' + qs);
        if (!res.ok) {
            setHistoryStatus('Log in to see your signing history.');
            return;
        }
        const { entries, nextCursor } = await res.json();
        entries.forEach(e => historyList.appendChild(historyItem(e)));
        historyCursor = nextCursor;
        historyMore.style.display = nextCursor ? 'inline-block' : 'none';
        setHistoryStatus(historyList.children.length ? '' : 'You haven\'t signed any files while logged in yet.');
    } catch (e) {
        setHistoryStatus('Could not load your signing history.');
    } finally {
        historyMore.disabled = false;
    }
}

historyMore.addEventListener('click', () => loadSigningHistory(false));
window.loadSigningHistory = loadSigningHistory;

// Re-fetch keys and history whenever the user opens the Settings page —
// they may have generated a key or signed a file in the meantime.
navItems.forEach(item => {
    if (item.getAttribute('data-section') === 'settings') {
        item.addEventListener('click', loadMyKeys);
        item.addEventListener('click', () => loadSigningHistory());
    }
});

window.loadMyKeys = loadMyKeys;

// Clears the account-card inputs and messages on logout.
window.resetAccountForms = function() {
    const ids = [
        'usernameCurrentPassword', 'newUsername',
        'passwordCurrentPassword', 'newPassword', 'confirmNewPassword',
        'deleteAccountPassword',
    ];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }
    for (const id of ['usernameMessage', 'passwordMessage', 'deleteAccountMessage']) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
    }
    if (myKeysList) myKeysList.innerHTML = '';
    if (myKeysStatus) {
        myKeysStatus.textContent = 'Loading your keys…';
        myKeysStatus.style.display = 'block';
    }
    // Signing history belongs to the previous user too.
    const historyListEl = document.getElementById('historyList');
    const historyStatusEl = document.getElementById('historyStatus');
    const historyMoreEl = document.getElementById('historyMore');
    if (historyListEl) historyListEl.replaceChildren();
    if (historyMoreEl) historyMoreEl.style.display = 'none';
    if (historyStatusEl) {
        historyStatusEl.textContent = 'Loading your history…';
        historyStatusEl.style.display = 'block';
    }
};

// ===== ACCOUNT (change username / change password) =====

function setAccountMessage(elementId, text, isError) {
    const el = document.getElementById(elementId);
    el.textContent = text;
    el.className = 'account-message ' + (isError ? 'error' : 'success');
    el.style.display = text ? 'block' : 'none';
}

const changeUsernameButton = document.getElementById('changeUsernameButton');
const changePasswordButton = document.getElementById('changePasswordButton');

changeUsernameButton.addEventListener('click', async () => {
    const currentPassword = document.getElementById('usernameCurrentPassword').value;
    const newUsername = document.getElementById('newUsername').value;

    if (!currentPassword || !newUsername.trim()) {
        setAccountMessage('usernameMessage', 'Both fields are required.', true);
        return;
    }

    changeUsernameButton.disabled = true;
    setAccountMessage('usernameMessage', '', false);
    try {
        const res = await fetch('/api/auth/username', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newUsername: newUsername.trim() }),
        });
        const data = await res.json();
        if (res.ok) {
            setAccountMessage('usernameMessage', 'Username updated.', false);
            document.getElementById('usernameCurrentPassword').value = '';
            document.getElementById('newUsername').value = '';
            if (typeof window.updateDisplayedUsername === 'function') {
                window.updateDisplayedUsername(data.user.username);
            }
        } else {
            setAccountMessage('usernameMessage', data.error || 'Update failed.', true);
        }
    } catch (e) {
        setAccountMessage('usernameMessage', 'Connection error.', true);
    } finally {
        changeUsernameButton.disabled = false;
    }
});

changePasswordButton.addEventListener('click', async () => {
    const currentPassword = document.getElementById('passwordCurrentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        setAccountMessage('passwordMessage', 'All fields are required.', true);
        return;
    }
    if (newPassword !== confirmNewPassword) {
        setAccountMessage('passwordMessage', 'New passwords do not match.', true);
        return;
    }

    changePasswordButton.disabled = true;
    setAccountMessage('passwordMessage', '', false);
    try {
        const res = await fetch('/api/auth/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await res.json();
        if (res.ok) {
            setAccountMessage('passwordMessage', 'Password updated.', false);
            document.getElementById('passwordCurrentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmNewPassword').value = '';
        } else {
            setAccountMessage('passwordMessage', data.error || 'Update failed.', true);
        }
    } catch (e) {
        setAccountMessage('passwordMessage', 'Connection error.', true);
    } finally {
        changePasswordButton.disabled = false;
    }
});

const deleteAccountButton = document.getElementById('deleteAccountButton');

deleteAccountButton.addEventListener('click', async () => {
    const currentPassword = document.getElementById('deleteAccountPassword').value;

    if (!currentPassword) {
        setAccountMessage('deleteAccountMessage', 'Enter your current password to confirm.', true);
        return;
    }
    if (!confirm('Delete your account? This cannot be undone. Your public keys and signing history will be kept for verification.')) {
        return;
    }

    deleteAccountButton.disabled = true;
    setAccountMessage('deleteAccountMessage', '', false);
    try {
        const res = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword }),
        });
        const data = await res.json();
        if (res.ok) {
            alert('Your account has been deleted.');
            // Reuse the logout flow to clear per-user state and return to the login page.
            document.getElementById('logoutButton').click();
        } else {
            setAccountMessage('deleteAccountMessage', data.error || 'Deletion failed.', true);
        }
    } catch (e) {
        setAccountMessage('deleteAccountMessage', 'Connection error.', true);
    } finally {
        deleteAccountButton.disabled = false;
    }
});