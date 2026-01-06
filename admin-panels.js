import { CONFIG } from './config.js';
import { createNewFile, fileToBase64, uploadPlayerHTML } from './github-api.js';
import { generatePlayerHTML } from './player-generator.js';
import { saveVideoMetadata } from './video-metadata.js';
import { validateCustomName, validateVideoFile } from './validation.js';
import { lockScroll, unlockScroll, suspendBackground, restoreBackground } from './scroll-lock.js';

export function initAdminPanel({
    role,
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
}) {
    if (role !== 'admin') {
        return;
    }

    document.getElementById('adminPanelBtn').style.display = 'block';

    document.getElementById('adminPanelBtn').onclick = () => {
        const panel = document.getElementById('adminPanel');
        panel.classList.add('show');
        suspendBackground(panel);
        lockScroll();
        displayAccounts();
    };

    document.getElementById('closeAdminBtn').onclick = () => {
        const panel = document.getElementById('adminPanel');
        panel.classList.remove('show');
        restoreBackground(panel);
        unlockScroll();
    };

    document.getElementById('createAccountBtn').onclick = createAccount;
    document.getElementById('importAccountsInput').onchange = handleImportFile;

    const editorToggleBtn = document.getElementById('editorAddToggleBtn');
    const editorStatus = document.getElementById('editorAddStatus');
    const updateEditorToggleUI = () => {
        const enabled = isEditorAddEnabled();
        editorToggleBtn.textContent = enabled ? 'Disable Editor Add Button' : 'Enable Editor Add Button';
        editorStatus.textContent = enabled ? 'Enabled' : 'Disabled';
    };

    updateEditorToggleUI();

    editorToggleBtn.onclick = () => {
        const nextValue = !isEditorAddEnabled();
        setEditorAddEnabled(nextValue);
        updateEditorToggleUI();
        showNotification('Editor Add Button', nextValue ? 'Enabled for editors.' : 'Hidden for editors.');
        addAuditLog('settings', `Editor add button ${nextValue ? 'enabled' : 'disabled'}`);
    };

    const auditSearch = document.getElementById('auditSearch');
    const auditFilter = document.getElementById('auditFilter');
    const exportAuditBtn = document.getElementById('exportAuditBtn');
    const clearAuditBtn = document.getElementById('clearAuditBtn');

    if (auditSearch) {
        auditSearch.oninput = (e) => {
            setAuditSearch(e.target.value || '');
            renderAuditLog();
        };
    }
    if (auditFilter) {
        auditFilter.onchange = (e) => {
            setAuditFilter(e.target.value || 'all');
            renderAuditLog();
        };
    }
    if (exportAuditBtn) {
        exportAuditBtn.onclick = exportAuditLog;
    }
    if (clearAuditBtn) {
        clearAuditBtn.onclick = () => {
            showConfirmModal({
                title: 'Clear Audit Log',
                message: 'Clear all audit log entries? This cannot be undone.',
                confirmLabel: 'Yes, Clear',
                onConfirm: () => {
                    clearAuditLog();
                    addAuditLog('settings', 'Audit log cleared');
                }
            });
        };
    }

    renderAuditLog();
}

export function initAddVideoPanel({ role, isEditorAddEnabled, showNotification, addAuditLog, getCurrentUser }) {
    const addVideoBtn = document.getElementById('addVideoPanelBtn');
    const editorAllowed = role === 'editor' && isEditorAddEnabled();
    const canShow = role === 'admin' || editorAllowed;

    addVideoBtn.style.display = canShow ? 'block' : 'none';
    addVideoBtn.classList.toggle('editor-corner', role === 'editor' && editorAllowed);
    addVideoBtn.onclick = null;

    if (!canShow) {
        return;
    }

    addVideoBtn.onclick = () => {
        const panel = document.getElementById('addVideoPanel');
        panel.classList.add('show');
        suspendBackground(panel);
        lockScroll();
    };

    document.getElementById('closeAddVideoBtn').onclick = () => {
        const panel = document.getElementById('addVideoPanel');
        panel.classList.remove('show');
        restoreBackground(panel);
        unlockScroll();
        resetAddVideoForm();
    };

    document.getElementById('uploadNewVideoBtn').onclick = () => handleAddVideo({
        showNotification,
        addAuditLog,
        getCurrentUser
    });
}

export function resetAddVideoForm() {
    document.getElementById('addVideoFile').value = '';
    document.getElementById('addVideoName').value = '';
    document.getElementById('addVideoFolder').value = 'spaces';
    document.getElementById('addVideoProgress').style.display = 'none';
    document.getElementById('addVideoButtons').style.display = 'block';
}

async function handleAddVideo({ showNotification, addAuditLog, getCurrentUser }) {
    const fileInput = document.getElementById('addVideoFile');
    const file = fileInput.files[0];
    const customName = document.getElementById('addVideoName').value.trim();
    const folder = document.getElementById('addVideoFolder').value;

    const fileValidation = validateVideoFile(file, 'Upload');
    if (!fileValidation.ok) {
        showNotification('Invalid File', fileValidation.message);
        return;
    }

    const nameValidation = validateCustomName(customName);
    if (!nameValidation.ok) {
        showNotification('Invalid Name', nameValidation.message);
        return;
    }

    const fileName = customName ? `${customName}.mp4` : file.name;

    const folderTypeMap = {
        [CONFIG.folders.spaces]: 'spaces',
        [CONFIG.folders.collect]: 'collect',
        [CONFIG.folders.franchises]: 'franchises'
    };
    const folderType = folderTypeMap[folder] || 'spaces';
    const existingFiles = window.menuManager.menus[folderType];
    const fileExists = existingFiles.some(menu =>
        menu.path === `${folder}/${fileName}` || menu.name === fileName
    );

    if (fileExists) {
        const message = `A file named "${fileName}" already exists in this folder.\n\nPlease choose a different name, or use "Replace Selected" to update the existing file.`;
        showNotification('File Already Exists', message);
        return;
    }

    document.getElementById('addVideoProgress').style.display = 'block';
    document.getElementById('addVideoButtons').style.display = 'none';
    document.getElementById('addVideoStatus').textContent = 'Preparing...';

    try {
        const progressBar = document.getElementById('addProgressFill');
        progressBar.style.width = '33%';

        const base64 = await fileToBase64(file);
        progressBar.style.width = '66%';
        document.getElementById('addVideoStatus').textContent = 'Uploading...';

        await createNewFile(folder, fileName, base64);

        const newFilePath = `${folder}/${fileName}`;
        saveVideoMetadata(newFilePath, getCurrentUser(), new Date().toISOString());
        addAuditLog('upload', `Added ${fileName} to ${folder}`);

        progressBar.style.width = '80%';
        document.getElementById('addVideoStatus').textContent = 'Creating player...';

        const playerHTML = generatePlayerHTML(folder, fileName);
        await uploadPlayerHTML(folder, fileName, playerHTML);

        progressBar.style.width = '100%';
        document.getElementById('addVideoStatus').textContent = 'Success!';

        setTimeout(() => {
            const panel = document.getElementById('addVideoPanel');
            panel.classList.remove('show');
            restoreBackground(panel);
            unlockScroll();
            resetAddVideoForm();
            if (window.menuManager) {
                window.menuManager.loadAllMenus();
            }
        }, 1500);
    } catch (error) {
        showNotification('Upload Failed', 'Upload failed: ' + error.message);
        document.getElementById('addVideoProgress').style.display = 'none';
        document.getElementById('addVideoButtons').style.display = 'block';
        addAuditLog('upload', `Add video failed: ${error.message}`, { status: 'error' });
    }
}
