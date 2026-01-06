let lockCount = 0;
let scrollY = 0;
const modalStack = [];
let observerInitialized = false;
let blockerInitialized = false;
const scrollContainersSelector = '.admin-container, .upload-modal, .confirm-modal, .delete-modal, .audit-log-list';

function hasOpenModal() {
    return Boolean(document.querySelector('.upload-overlay.show, .admin-panel.show, .fullscreen.show'));
}

function forceUnlockScroll(restorePosition) {
    lockCount = 0;
    document.body.classList.remove('no-scroll');
    document.documentElement.classList.remove('no-scroll');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.paddingRight = '';
    if (restorePosition) {
        window.scrollTo(0, scrollY);
    }
}

function initScrollObserver() {
    if (observerInitialized) return;
    observerInitialized = true;
    const observer = new MutationObserver(() => {
        if (lockCount > 0 && !hasOpenModal()) {
            forceUnlockScroll(true);
        }
    });
    observer.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class', 'style']
    });
}

function getSuspendCount(modal) {
    return parseInt(modal.dataset.suspendCount || '0', 10);
}

function isModalEligible(modal) {
    if (!modal) return false;
    const count = getSuspendCount(modal);
    if (count > 0) return true;
    const style = window.getComputedStyle(modal);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function initScrollBlocker() {
    if (blockerInitialized) return;
    blockerInitialized = true;

    const shouldBlockEvent = (event) => {
        if (lockCount === 0) return false;
        const target = event.target instanceof Element ? event.target : null;
        const container = target ? target.closest(scrollContainersSelector) : null;
        if (!container) return true;

        if (event.type !== 'wheel') return false;
        const deltaY = event.deltaY || 0;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return false;

        if (deltaY > 0 && container.scrollTop >= maxScroll) return true;
        if (deltaY < 0 && container.scrollTop <= 0) return true;
        return false;
    };

    document.addEventListener('wheel', (event) => {
        if (shouldBlockEvent(event)) {
            event.preventDefault();
        }
    }, { passive: false });

    document.addEventListener('touchmove', (event) => {
        if (shouldBlockEvent(event)) {
            event.preventDefault();
        }
    }, { passive: false });
}

export function lockScroll() {
    lockCount += 1;
    if (lockCount > 1) return;

    initScrollObserver();
    initScrollBlocker();

    const docEl = document.documentElement;
    const body = document.body;

    scrollY = window.scrollY || docEl.scrollTop || 0;
    body.classList.add('no-scroll');
    docEl.classList.add('no-scroll');
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
}

export function unlockScroll() {
    if (lockCount === 0) return;
    lockCount -= 1;
    if (lockCount > 0) return;

    const top = document.body.style.top;
    forceUnlockScroll(false);

    const parsedTop = parseInt(top || '0', 10);
    const restoreY = Number.isNaN(parsedTop) ? scrollY : Math.abs(parsedTop);
    window.scrollTo(0, restoreY);
}

export function suspendBackground(activeModal) {
    if (!activeModal) return;
    const modals = document.querySelectorAll('.upload-overlay, .admin-panel, .fullscreen');
    const suspended = [];

    modals.forEach(modal => {
        if (modal === activeModal) return;
        if (!isModalEligible(modal)) return;

        const count = getSuspendCount(modal);
        modal.dataset.suspendCount = String(count + 1);
        if (count === 0) {
            modal.classList.add('modal-suspended');
        }
        suspended.push(modal);
    });

    modalStack.push({ activeModal, suspended });
}

export function restoreBackground(activeModal) {
    if (!activeModal) return;
    let entryIndex = -1;
    for (let i = modalStack.length - 1; i >= 0; i -= 1) {
        if (modalStack[i].activeModal === activeModal) {
            entryIndex = i;
            break;
        }
    }
    if (entryIndex === -1) return;

    const entry = modalStack.splice(entryIndex, 1)[0];
    entry.suspended.forEach(modal => {
        const count = getSuspendCount(modal);
        const nextCount = Math.max(0, count - 1);
        if (nextCount === 0) {
            modal.classList.remove('modal-suspended');
            delete modal.dataset.suspendCount;
        } else {
            modal.dataset.suspendCount = String(nextCount);
        }
    });
}
