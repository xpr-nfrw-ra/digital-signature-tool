// auth.js - Authentication and login functionality

let currentUser = null;

// DOM elements
const loginPage = document.getElementById('loginPage');
const mainApp = document.getElementById('mainApp');
const loginButton = document.getElementById('loginButton');
const guestButton = document.getElementById('guestButton');
const userInfo = document.getElementById('userInfo');
const displayUsername = document.getElementById('displayUsername');
const logoutButton = document.getElementById('logoutButton');

// Login button handler
loginButton.addEventListener('click', () => {
    const username = document.getElementById('username').value;
    if (username.trim()) {
        currentUser = username;
        displayUsername.textContent = `Logged in as: ${username}`;
        userInfo.style.display = 'block';
    }
    loginPage.style.display = 'none';
    mainApp.classList.add('active');
});

// Guest button handler
guestButton.addEventListener('click', () => {
    currentUser = null;
    userInfo.style.display = 'none';
    loginPage.style.display = 'none';
    mainApp.classList.add('active');
});

// Logout button handler
logoutButton.addEventListener('click', () => {
    currentUser = null;
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    mainApp.classList.remove('active');
    loginPage.style.display = 'flex';
});