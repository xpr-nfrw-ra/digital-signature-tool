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

function applySettingsToUI(s) {
    appSettings.hashAlgorithm = s.hashAlgorithm;
    appSettings.signatureAlgorithm = s.signatureAlgorithm;
    appSettings.keySize = String(s.keySize);
    hashAlgorithm.value = s.hashAlgorithm;
    signatureAlgorithm.value = s.signatureAlgorithm;
    keySize.value = String(s.keySize);
}

async function loadSettingsFromServer() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) return; // guest or not logged in
        const { settings } = await res.json();
        applySettingsToUI(settings);
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
    persistSetting({ signatureAlgorithm: e.target.value });
});

keySize.addEventListener('change', (e) => {
    appSettings.keySize = e.target.value;
    persistSetting({ keySize: Number(e.target.value) });
});

// Expose for auth.js to call after successful login.
window.loadSettingsFromServer = loadSettingsFromServer;