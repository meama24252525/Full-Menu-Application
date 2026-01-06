import { MenuManager } from './menu-manager.js';
import { showNotification, initNotifications } from './notifications.js';

import { configureAuditLog, addAuditLog, renderAuditLog, exportAuditLog, clearAuditLog, setAuditSearch, setAuditFilter } from './audit-log.js';
import { configureAccounts, loadAccounts, setAccounts, displayAccounts, createAccount, deleteAccount, exportAccounts, importAccounts, handleImportFile } from './accounts.js';
import { checkSession, setupLogin, logout, showFirstTimeSetup, SESSION_DURATION } from './auth.js';
import { initAdminPanel, initAddVideoPanel, resetAddVideoForm } from './admin-panels.js';
import { getCurrentUser, getCurrentRole, setSession, clearSession } from './session.js';
import { showConfirmModal } from './ui-modals.js';
import { isEditorAddEnabled, setEditorAddEnabled } from './settings.js';
import { unlockScroll, restoreBackground } from './scroll-lock.js';

configureAuditLog({
    getCurrentUser,
    getCurrentRole,
    showNotification
});

configureAccounts({
    showNotification,
    addAuditLog
});

window.exportAccounts = exportAccounts;
window.importAccounts = importAccounts;
window.deleteAccount = deleteAccount;

window.addEventListener('DOMContentLoaded', () => {
    initNotifications();
    checkSession({
        loadAccounts,
        setSession,
        initializeApp,
        setupLogin: startLogin,
        showFirstTimeSetup: startFirstTimeSetup
    });
});

function startFirstTimeSetup() {
    showFirstTimeSetup({
        setAccounts
    });
}

function startLogin() {
    setupLogin({
        loadAccounts,
        setSession,
        initializeApp,
        addAuditLog
    });
}

function handleLogout() {
    if (window.sessionTimerId) {
        clearInterval(window.sessionTimerId);
        window.sessionTimerId = null;
    }
    logout({
        getCurrentUser,
        getCurrentRole,
        clearSession,
        setupLogin: startLogin,
        addAuditLog
    });
}

function startSessionTimer() {
    if (window.sessionTimerId) {
        clearInterval(window.sessionTimerId);
    }

    const checkExpiry = () => {
        const loginTime = parseInt(localStorage.getItem('loginTime') || '0', 10);
        if (!loginTime) return;
        if (Date.now() - loginTime >= SESSION_DURATION) {
            handleLogout();
        }
    };

    checkExpiry();
    window.sessionTimerId = setInterval(checkExpiry, 30000);
}

function initializeApp() {
    document.getElementById('logoutBtn').onclick = handleLogout;

    const currentRole = getCurrentRole();
    const roleDisplay = currentRole ? currentRole.charAt(0).toUpperCase() + currentRole.slice(1) : '';
    document.getElementById('userRole').textContent = roleDisplay ? `(${roleDisplay})` : '';

    document.getElementById('adminPanelBtn').style.display = 'none';
    document.getElementById('addVideoPanelBtn').style.display = 'none';
    startSessionTimer();

    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'r' && !e.target.matches('input, textarea')) {
            if (window.menuManager) {
                window.menuManager.loadAllMenus();
            }
        }

        if (e.key === 'Escape') {
            const adminPanel = document.getElementById('adminPanel');
            if (adminPanel.classList.contains('show')) {
                adminPanel.classList.remove('show');
                restoreBackground(adminPanel);
                unlockScroll();
            }
            const videoInfoPanel = document.getElementById('videoInfoPanel');
            if (videoInfoPanel.classList.contains('show')) {
                videoInfoPanel.classList.remove('show');
                restoreBackground(videoInfoPanel);
                unlockScroll();
            }
            const addVideoPanel = document.getElementById('addVideoPanel');
            if (addVideoPanel.classList.contains('show')) {
                addVideoPanel.classList.remove('show');
                restoreBackground(addVideoPanel);
                unlockScroll();
                resetAddVideoForm();
            }

            if (window.menuManager) {
                window.menuManager.videoPlayer.close();
                window.menuManager.closeUploadModal();
                window.menuManager.closeDeleteModal();
            }
        }
    });

    document.getElementById('closeVideoInfoBtn').onclick = () => {
        const panel = document.getElementById('videoInfoPanel');
        panel.classList.remove('show');
        restoreBackground(panel);
        unlockScroll();
    };

    initAddVideoPanel({
        role: currentRole,
        isEditorAddEnabled,
        showNotification,
        addAuditLog,
        getCurrentUser
    });

    initAdminPanel({
        role: currentRole,
        displayAccounts,
        createAccount,
        handleImportFile,
        isEditorAddEnabled,
        setEditorAddEnabled,
        showNotification,
        addAuditLog,
        setAuditSearch,
        setAuditFilter,
        renderAuditLog,
        exportAuditLog,
        clearAuditLog,
        showConfirmModal
    });

    const menuManager = new MenuManager({
        userRole: currentRole,
        getCurrentUser: () => getCurrentUser(),
        logAudit: addAuditLog
    });
    window.menuManager = menuManager;
}
