import { lockScroll, unlockScroll, suspendBackground, restoreBackground } from './scroll-lock.js';

export function showNotification(title, message) {
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');
    const overlay = document.getElementById('notificationOverlay');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (overlay) overlay.classList.add('show');
    suspendBackground(overlay);
    lockScroll();
}

export function closeNotification() {
    const overlay = document.getElementById('notificationOverlay');
    if (overlay) overlay.classList.remove('show');
    restoreBackground(overlay);
    unlockScroll();
}

export function initNotifications() {
    const register = () => {
        const okBtn = document.getElementById('notificationOkBtn');
        if (okBtn) {
            okBtn.onclick = closeNotification;
        }

        document.addEventListener('keydown', (e) => {
            const overlay = document.getElementById('notificationOverlay');
            if (e.key === 'Escape' && overlay && overlay.classList.contains('show')) {
                closeNotification();
            }
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register);
    } else {
        register();
    }
}
