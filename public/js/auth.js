// auth.js - Authentication and login functionality

let currentUser = null;
let isRegisterMode = false;

// DOM elements
const loginPage = document.getElementById('loginPage');
const mainApp = document.getElementById('mainApp');
const loginButton = document.getElementById('loginButton');
const guestButton = document.getElementById('guestButton');
const userInfo = document.getElementById('userInfo');
const displayUsername = document.getElementById('displayUsername');
const logoutButton = document.getElementById('logoutButton');
const loginError = document.getElementById('loginError');
const toggleAuthLink = document.getElementById('toggleAuthLink');
const loginTitle = document.querySelector('.login-header p');
const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');

// Password visibility toggles
document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
        } else {
            input.type = 'password';
            btn.textContent = '👁';
        }
    });
});

function showApp(username) {
    currentUser = username;
    displayUsername.textContent = 'Logged in as: ' + username;
    userInfo.style.display = 'block';
    loginPage.style.display = 'none';
    mainApp.classList.add('active');
    hideError();
}

function showError(msg) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
}

function hideError() {
    loginError.style.display = 'none';
    loginError.textContent = '';
}

function setRegisterMode(register) {
    isRegisterMode = register;
    hideError();
    const confirmInput = document.getElementById('confirmPassword');
    confirmInput.value = '';
    confirmInput.type = 'password';
    document.querySelector('[data-target="confirmPassword"]').textContent = '👁';
    document.getElementById('password').type = 'password';
    document.querySelector('[data-target="password"]').textContent = '👁';
    if (register) {
        loginButton.textContent = 'Register';
        loginTitle.textContent = 'Create a new account';
        toggleAuthLink.innerHTML = 'Already have an account? <a href="#">Login here</a>';
        confirmPasswordGroup.style.display = 'block';
    } else {
        loginButton.textContent = 'Login';
        loginTitle.textContent = 'Sign in to access your settings and keys';
        toggleAuthLink.innerHTML = 'Don\'t have an account? <a href="#">Register here</a>';
        confirmPasswordGroup.style.display = 'none';
    }
}

// Toggle between login and register mode
toggleAuthLink.addEventListener('click', (e) => {
    e.preventDefault();
    setRegisterMode(!isRegisterMode);
});

// Login / Register button handler
loginButton.addEventListener('click', async () => {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!username.trim() || !password.trim()) {
        showError('Please enter both username and password');
        return;
    }

    if (isRegisterMode) {
        const confirmPassword = document.getElementById('confirmPassword').value;
        if (!confirmPassword) {
            showError('Please confirm your password');
            return;
        }
        if (password !== confirmPassword) {
            showError('Passwords do not match');
            return;
        }
    }

    const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

    try {
        loginButton.disabled = true;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username.trim(), password })
        });
        const data = await res.json();

        if (res.ok) {
            showApp(data.user.username);
        } else {
            showError(data.error || 'Authentication failed');
        }
    } catch (e) {
        showError('Connection error. Is the server running?');
    } finally {
        loginButton.disabled = false;
    }
});

// Guest button handler
guestButton.addEventListener('click', () => {
    currentUser = null;
    userInfo.style.display = 'none';
    loginPage.style.display = 'none';
    mainApp.classList.add('active');
});

// Logout button handler
logoutButton.addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
        // Logout locally even if server call fails
    }
    currentUser = null;
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('confirmPassword').value = '';
    mainApp.classList.remove('active');
    loginPage.style.display = 'flex';
    setRegisterMode(false);
});

// Check for existing session on page load
async function checkSession() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            showApp(data.user.username);
        }
    } catch (e) {
        // No session or server not reachable, stay on login page
    }
}

checkSession();
