const AUDIT_LOG_KEY = 'menuManagerAuditLog';
const AUDIT_LOG_LIMIT = 500;
const auditState = {
    filter: 'all',
    search: ''
};

let getCurrentUser = () => null;
let getCurrentRole = () => null;
let notify = () => {};

export function configureAuditLog({ getCurrentUser: userGetter, getCurrentRole: roleGetter, showNotification }) {
    if (typeof userGetter === 'function') {
        getCurrentUser = userGetter;
    }
    if (typeof roleGetter === 'function') {
        getCurrentRole = roleGetter;
    }
    if (typeof showNotification === 'function') {
        notify = showNotification;
    }
}

function loadAuditLog() {
    const stored = localStorage.getItem(AUDIT_LOG_KEY);
    if (!stored) return [];
    try {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('Failed to parse audit log', error);
        return [];
    }
}

function saveAuditLog(entries) {
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(entries));
}

function escapeHtml(text) {
    return (text || '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function setAuditSearch(value) {
    auditState.search = value || '';
}

export function setAuditFilter(value) {
    auditState.filter = value || 'all';
}

export function addAuditLog(action, details, overrides = {}) {
    if (action === 'login' || action === 'logout') {
        return;
    }
    const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ts: new Date().toISOString(),
        user: overrides.user || getCurrentUser() || 'unknown',
        role: overrides.role || getCurrentRole() || 'unknown',
        action: action || 'unknown',
        details: details || '',
        status: overrides.status || 'info'
    };

    const entries = loadAuditLog();
    entries.unshift(entry);
    if (entries.length > AUDIT_LOG_LIMIT) {
        entries.length = AUDIT_LOG_LIMIT;
    }
    saveAuditLog(entries);
    renderAuditLog();
}

export function renderAuditLog() {
    const list = document.getElementById('auditLogList');
    if (!list) return;

    const query = (auditState.search || '').toLowerCase();
    const entries = loadAuditLog().filter(entry => {
        const matchesFilter = auditState.filter === 'all' || entry.action === auditState.filter;
        if (!matchesFilter) return false;
        if (!query) return true;
        const combined = `${entry.user} ${entry.role} ${entry.action} ${entry.details}`.toLowerCase();
        return combined.includes(query);
    });

    if (entries.length === 0) {
        list.innerHTML = '<div class="audit-row">No audit entries found.</div>';
        return;
    }

    list.innerHTML = entries.map(entry => {
        const time = new Date(entry.ts).toLocaleString();
        return `
            <div class="audit-row">
                <div><strong>Time</strong><br>${escapeHtml(time)}</div>
                <div><strong>User</strong><br>${escapeHtml(entry.user)}</div>
                <div><strong>Action</strong><br>${escapeHtml(entry.action)}</div>
                <div><strong>Details</strong><br>${escapeHtml(entry.details)}</div>
            </div>
        `;
    }).join('');
}

export function exportAuditLog() {
    const entries = loadAuditLog();
    if (!entries.length) {
        notify('No Logs', 'There are no audit log entries to export.');
        return;
    }

    const dataStr = JSON.stringify(entries, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `menu-manager-audit-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function clearAuditLog() {
    localStorage.removeItem(AUDIT_LOG_KEY);
    renderAuditLog();
}
