import { lockScroll, unlockScroll, suspendBackground, restoreBackground } from './scroll-lock.js';

export function showConfirmModal({ title, message, confirmLabel, onConfirm }) {
    const overlay = document.getElementById('confirmOverlay');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYesBtn');
    const noBtn = document.getElementById('confirmNoBtn');

    if (!overlay || !titleEl || !messageEl || !yesBtn || !noBtn) {
        if (confirm(message)) {
            onConfirm();
        }
        return;
    }

    titleEl.textContent = title || 'Confirm Action';
    messageEl.textContent = message || 'Are you sure?';
    yesBtn.textContent = confirmLabel || 'Confirm';

    const cleanup = () => {
        overlay.classList.remove('show');
        restoreBackground(overlay);
        unlockScroll();
        yesBtn.onclick = null;
        noBtn.onclick = null;
    };

    yesBtn.onclick = () => {
        cleanup();
        onConfirm();
    };
    noBtn.onclick = cleanup;

    overlay.classList.add('show');
    suspendBackground(overlay);
    lockScroll();
}
