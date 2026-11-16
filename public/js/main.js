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

// Each load gets a number; a response that arrives after a newer load started (or after
// logout) is dropped, so lists never show stale or duplicated data.
let keysRequest = 0;
let historyRequest = 0;

async function loadMyKeys() {
    if (!myKeysList) return;
    const request = ++keysRequest;
    try {
        const res = await fetch('/api/keys/mine');
        if (request !== keysRequest) return;
        if (!res.ok) {
            myKeysStatus.textContent = 'Log in to manage your preferred signing key.';
            myKeysList.innerHTML = '';
            return;
        }
        const { keys } = await res.json();
        if (request !== keysRequest) return;
        renderMyKeys(keys, appSettings.defaultPublicKeyId ?? null);
    } catch (e) {
        if (request !== keysRequest) return;
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
        historyRequest++;
        historyCursor = null;
        historyList.replaceChildren();
        historyMore.style.display = 'none';
        setHistoryStatus('Loading your history…');
    }
    const request = historyRequest;
    historyMore.disabled = true;
    try {
        const qs = `limit=${HISTORY_PAGE_SIZE}` + (historyCursor ? `&cursor=${historyCursor}` : '');
        const res = await fetch('/api/signatures/mine?' + qs);
        if (request !== historyRequest) return;
        if (!res.ok) {
            setHistoryStatus('Log in to see your signing history.');
            return;
        }
        const { entries, nextCursor } = await res.json();
        if (request !== historyRequest) return;
        entries.forEach(e => historyList.appendChild(historyItem(e)));
        historyCursor = nextCursor;
        historyMore.style.display = nextCursor ? 'inline-block' : 'none';
        setHistoryStatus(historyList.children.length ? '' : 'You haven\'t signed any files while logged in yet.');
    } catch (e) {
        if (request === historyRequest) setHistoryStatus('Could not load your signing history.');
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

// On logout: closes any account dialog, clears the account message, wipes the previous
// user's keys and signing history from the Settings page, and returns to File Signing,
// so the next user (or a guest) never sees the previous user's data.
window.resetAccountForms = function() {
    closeAccountModal();
    setAccountMessage('accountMessage', '', false);

    keysRequest++;
    myKeysList.replaceChildren();
    myKeysStatus.textContent = 'Loading your keys…';
    myKeysStatus.style.display = 'block';

    historyRequest++;
    historyCursor = null;
    historyList.replaceChildren();
    historyMore.style.display = 'none';
    setHistoryStatus('Loading your history…');

    document.querySelector('.nav-item[data-section="signing"]').click();
};

// ===== ACCOUNT (change username / change password / delete account) =====
// The Account card shows one row per action; each "Change"/"Delete…" button opens
// a dialog that asks for only what that action needs, including the current password.

function setAccountMessage(elementId, text, isError) {
    const el = document.getElementById(elementId);
    el.textContent = text;
    el.className = 'account-message ' + (isError ? 'error' : 'success');
    el.style.display = text ? 'block' : 'none';
}

const accountModals = {
    username: { overlay: 'usernameModal', message: 'usernameMessage', firstInput: 'newUsername' },
    password: { overlay: 'passwordModal', message: 'passwordMessage', firstInput: 'passwordCurrentPassword' },
    delete:   { overlay: 'deleteModal',   message: 'deleteAccountMessage', firstInput: 'deleteAccountPassword' },
};
let openAccountModal = null;
let accountModalOpener = null;

// Empties every field in a dialog and puts the show/hide-password toggles back to "hidden".
function clearAccountModal(overlay) {
    overlay.querySelectorAll('input').forEach(input => {
        input.value = '';
        if (input.closest('.password-wrapper')) input.type = 'password';
    });
    overlay.querySelectorAll('.password-toggle').forEach(btn => { btn.textContent = '👁'; });
}

function showAccountModal(name, opener) {
    const m = accountModals[name];
    const overlay = document.getElementById(m.overlay);
    closeAccountModal();
    clearAccountModal(overlay);
    setAccountMessage(m.message, '', false);
    setAccountMessage('accountMessage', '', false);
    overlay.classList.add('active');
    openAccountModal = name;
    accountModalOpener = opener || null;
    document.getElementById(m.firstInput).focus();
}

function closeAccountModal() {
    if (!openAccountModal) return;
    const overlay = document.getElementById(accountModals[openAccountModal].overlay);
    overlay.classList.remove('active');
    clearAccountModal(overlay);
    openAccountModal = null;
    if (accountModalOpener && document.body.contains(accountModalOpener)) accountModalOpener.focus();
    accountModalOpener = null;
}

document.getElementById('openUsernameModal').addEventListener('click', e => showAccountModal('username', e.currentTarget));
document.getElementById('openPasswordModal').addEventListener('click', e => showAccountModal('password', e.currentTarget));
document.getElementById('openDeleteModal').addEventListener('click', e => showAccountModal('delete', e.currentTarget));

// Cancel button, a click on the dimmed background, or Escape closes the dialog.
document.querySelectorAll('.account-modal').forEach(overlay => {
    overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('[data-close-modal]')) closeAccountModal();
    });
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openAccountModal) closeAccountModal();
});

const changeUsernameButton = document.getElementById('changeUsernameButton');
const changePasswordButton = document.getElementById('changePasswordButton');
const deleteAccountButton = document.getElementById('deleteAccountButton');

document.getElementById('usernameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
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
            if (typeof window.updateDisplayedUsername === 'function') {
                window.updateDisplayedUsername(data.user.username);
            }
            closeAccountModal();
            setAccountMessage('accountMessage', 'Username updated.', false);
        } else {
            setAccountMessage('usernameMessage', data.error || 'Update failed.', true);
        }
    } catch (e) {
        setAccountMessage('usernameMessage', 'Connection error.', true);
    } finally {
        changeUsernameButton.disabled = false;
    }
});

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
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
            closeAccountModal();
            setAccountMessage('accountMessage', 'Password updated.', false);
        } else {
            setAccountMessage('passwordMessage', data.error || 'Update failed.', true);
        }
    } catch (e) {
        setAccountMessage('passwordMessage', 'Connection error.', true);
    } finally {
        changePasswordButton.disabled = false;
    }
});

// The dialog itself (warning text + password) is the confirmation step.
document.getElementById('deleteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('deleteAccountPassword').value;

    if (!currentPassword) {
        setAccountMessage('deleteAccountMessage', 'Enter your current password to confirm.', true);
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
            closeAccountModal();
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
