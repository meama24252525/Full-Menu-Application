let accountsCache = null;
let notify = () => {};
let logAudit = () => {};

export function configureAccounts({ showNotification, addAuditLog }) {
    if (typeof showNotification === 'function') {
        notify = showNotification;
    }
    if (typeof addAuditLog === 'function') {
        logAudit = addAuditLog;
    }
}

export function loadAccounts() {
    const stored = localStorage.getItem('menuManagerAccounts');
    if (stored) {
        const accounts = JSON.parse(stored);

        let needsMigration = false;
        for (const [username, data] of Object.entries(accounts)) {
            if (typeof data === 'string') {
                needsMigration = true;
                accounts[username] = {
                    password: data,
                    role: username === 'admin' ? 'admin' : 'editor'
                };
            }
        }

        if (needsMigration) {
            saveAccounts(accounts);
        } else {
            accountsCache = accounts;
        }

        return accountsCache;
    }

    accountsCache = null;
    return null;
}

export function saveAccounts(accounts) {
    accountsCache = accounts;
    localStorage.setItem('menuManagerAccounts', JSON.stringify(accounts));
}

export function setAccounts(accounts) {
    saveAccounts(accounts);
}

export function getAccounts() {
    if (accountsCache) return accountsCache;
    return loadAccounts();
}

export function exportAccounts() {
    const accounts = getAccounts();
    if (!accounts) {
        notify('No Accounts', 'No accounts to export');
        return;
    }

    const dataStr = JSON.stringify(accounts, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `menu-manager-accounts-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    notify('Success', 'Accounts exported successfully!');
    logAudit('account', 'Exported accounts');
}

export function importAccounts() {
    const input = document.getElementById('importAccountsInput');
    if (input) {
        input.click();
    }
}

export function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);

            if (typeof imported !== 'object' || !imported) {
                throw new Error('Invalid file format');
            }

            for (const [, data] of Object.entries(imported)) {
                if (!data.password || !data.role) {
                    throw new Error('Invalid account data structure');
                }
            }

            setAccounts(imported);
            displayAccounts();
            notify('Success', 'Accounts imported successfully!');
            logAudit('account', 'Imported accounts');
        } catch (error) {
            notify('Import Failed', 'Import failed: ' + error.message);
            logAudit('account', `Account import failed: ${error.message}`, { status: 'error' });
        }
    };
    reader.readAsText(file);

    event.target.value = '';
}

export function displayAccounts() {
    const accountsList = document.getElementById('accountsList');
    if (!accountsList) return;

    const accounts = getAccounts() || {};
    let html = '';

    for (const [username, data] of Object.entries(accounts)) {
        const roleName = data.role.charAt(0).toUpperCase() + data.role.slice(1);
        html += `
            <div class="account-item">
                <div>
                    <div class="username">
                        ${username}
                        <span class="role-badge ${data.role}">${roleName}</span>
                    </div>
                    <div style="font-size: 11px; color: #666;">Password: ${data.password}</div>
                </div>
                <div class="actions">
                    ${username !== 'admin' ? `<button class="btn delete" onclick="deleteAccount('${username}')">Delete</button>` : '<span style="font-size: 11px; color: #999;">Protected</span>'}
                </div>
            </div>
        `;
    }

    accountsList.innerHTML = html || '<p>No accounts found</p>';
}

export function createAccount() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;

    if (!username || !password) {
        notify('Missing Information', 'Please enter both username and password');
        return;
    }

    const accounts = getAccounts() || {};
    if (accounts[username]) {
        notify('Username Exists', 'Username already exists');
        return;
    }

    accounts[username] = { password: password, role: role };
    saveAccounts(accounts);

    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newRole').value = 'viewer';

    displayAccounts();
    notify('Account Created', `Account "${username}" created successfully with ${role} role`);
    logAudit('account', `Created ${role} account: ${username}`);
}

export function deleteAccount(username) {
    if (username === 'admin') {
        notify('Protected Account', 'Cannot delete admin account');
        return;
    }

    const accounts = getAccounts() || {};
    delete accounts[username];
    saveAccounts(accounts);
    displayAccounts();
    logAudit('account', `Deleted account: ${username}`);
}
