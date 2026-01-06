import { unlockScroll, restoreBackground } from './scroll-lock.js';

export const SESSION_DURATION = 30 * 60 * 1000;

export function showFirstTimeSetup({ setAccounts }) {
    document.getElementById('loginScreen').style.display = 'flex';
    document.body.classList.add('login-active');
    document.documentElement.classList.add('login-active');
    const loginBox = document.querySelector('.login-box');
    loginBox.innerHTML = `
        <h2 style="text-align: center;">First Time Setup</h2>
        <p style="font-size: 12px; color: #666; margin-bottom: 15px; text-align: center;">Create your admin account</p>
        <input type="password" id="newAdminPassword" placeholder="Admin Password" autocomplete="new-password">
        <input type="password" id="confirmAdminPassword" placeholder="Confirm Password" autocomplete="new-password">
        <button class="btn primary" id="setupBtn">Create Admin Account</button>
        <p id="setupError" class="login-error" style="display: none;"></p>
    `;

    const setupBtn = document.getElementById('setupBtn');
    const newPassword = document.getElementById('newAdminPassword');
    const confirmPassword = document.getElementById('confirmAdminPassword');

    const handleSetup = () => {
        const password = newPassword.value;
        const confirm = confirmPassword.value;
        const error = document.getElementById('setupError');

        if (!password || password.length < 6) {
            error.textContent = 'Password must be at least 6 characters';
            error.style.display = 'block';
            setTimeout(() => {
                error.style.display = 'none';
            }, 5000);
            return;
        }

        if (password !== confirm) {
            error.textContent = 'Passwords do not match';
            error.style.display = 'block';
            setTimeout(() => {
                error.style.display = 'none';
            }, 5000);
            return;
        }

        const newAccounts = {
            'admin': { password: password, role: 'admin' }
        };
        setAccounts(newAccounts);
        location.reload();
    };

    setupBtn.onclick = handleSetup;

    confirmPassword.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSetup();
        }
    };

    setTimeout(() => newPassword.focus(), 100);
}

export function checkSession({ loadAccounts, setSession, initializeApp, setupLogin, showFirstTimeSetup }) {
    const accounts = loadAccounts();

    if (!accounts || Object.keys(accounts).length === 0) {
        showFirstTimeSetup();
        return;
    }

    const loginTime = localStorage.getItem('loginTime');
    const currentTime = Date.now();

    if (loginTime && (currentTime - parseInt(loginTime)) < SESSION_DURATION) {
        const currentUser = localStorage.getItem('currentUser') || null;
        const currentRole = localStorage.getItem('currentRole') || null;
        setSession(currentUser, currentRole);

        document.getElementById('adminPanelBtn').style.display = 'none';
        document.getElementById('addVideoPanelBtn').style.display = 'none';

        document.getElementById('loginScreen').style.display = 'none';
        document.body.classList.remove('login-active');
        document.documentElement.classList.remove('login-active');
        initializeApp();
    } else {
        localStorage.removeItem('loginTime');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('currentRole');
        setupLogin();
    }
}

export function setupLogin({ loadAccounts, setSession, initializeApp, addAuditLog }) {
    document.getElementById('loginScreen').style.display = 'flex';
    const loginBtn = document.getElementById('loginBtn');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMsg = document.getElementById('loginError');

    usernameInput.value = '';
    passwordInput.value = '';
    errorMsg.style.display = 'none';
    document.body.classList.add('login-active');
    document.documentElement.classList.add('login-active');

    loginBtn.onclick = attemptLogin;

    usernameInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            passwordInput.focus();
        }
    };

    passwordInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            attemptLogin();
        }
    };

    function attemptLogin() {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        const accounts = loadAccounts() || {};

        if (accounts[username] && accounts[username].password === password) {
            setSession(username, accounts[username].role);
            localStorage.setItem('loginTime', Date.now().toString());
            localStorage.setItem('currentUser', username);
            localStorage.setItem('currentRole', accounts[username].role);
            document.getElementById('loginScreen').style.display = 'none';
            document.body.classList.remove('login-active');
            document.documentElement.classList.remove('login-active');
            usernameInput.value = '';
            passwordInput.value = '';
            errorMsg.style.display = 'none';
            initializeApp();
            if (addAuditLog) {
                addAuditLog('login', `User ${username} signed in`, { user: username, role: accounts[username].role });
            }
        } else {
            errorMsg.style.display = 'block';
            passwordInput.value = '';
            passwordInput.focus();

            setTimeout(() => {
                errorMsg.style.display = 'none';
            }, 5000);
        }
    }

    setTimeout(() => usernameInput.focus(), 100);
}

export function logout({ getCurrentUser, getCurrentRole, clearSession, setupLogin, addAuditLog }) {
    const previousUser = getCurrentUser ? getCurrentUser() : null;
    const previousRole = getCurrentRole ? getCurrentRole() : null;

    localStorage.removeItem('loginTime');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentRole');
    if (clearSession) {
        clearSession();
    }

    const adminPanel = document.getElementById('adminPanel');
    adminPanel.classList.remove('show');
    restoreBackground(adminPanel);
    document.getElementById('adminPanelBtn').style.display = 'none';
    const videoInfoPanel = document.getElementById('videoInfoPanel');
    videoInfoPanel.classList.remove('show');
    restoreBackground(videoInfoPanel);
    unlockScroll();
    document.getElementById('content').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading menu files...</p></div>';

    document.getElementById('loginScreen').style.display = 'flex';
    document.body.classList.add('login-active');
    document.documentElement.classList.add('login-active');

    setTimeout(() => {
        setupLogin();
    }, 200);

    if (addAuditLog) {
        addAuditLog('logout', 'User signed out', { user: previousUser || 'unknown', role: previousRole || 'unknown' });
    }
}
