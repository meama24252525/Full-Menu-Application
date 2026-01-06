import { CONFIG } from './config.js';
import { loadMenusFromFolder, getCurrentFileInfo, replaceFile, deleteFile, fileToBase64, deletePlayerHTML } from './github-api.js';
import { VideoPlayer } from './video-player.js';
import { showNotification } from './notifications.js';
import { getLastUpdated, saveVideoMetadata } from './video-metadata.js';
import { ReplacementCache } from './replacement-cache.js';
import { lockScroll, unlockScroll, suspendBackground, restoreBackground } from './scroll-lock.js';

const SCHEDULE_STORAGE_KEY = 'videoSwapSchedule';
const MENU_CACHE_KEY = 'menuCache-v1';
const MENU_CACHE_TTL = 5 * 60 * 1000;
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DISPLAY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_SCHEDULE = {
    id: '',
    days: [],
    folder: CONFIG.folders.spaces,
    targetPath: '',
    replacementPath: '',
    replacementName: '',
    replacementBase64: null,
    replacementStored: false,
    replacementCacheKey: '',
    revertAfterHours: 24,
    lastRunDate: null,
    lastRevertDate: null,
    activeUntil: null,
    active: false,
    backupBase64: null,
    backupSha: null,
    backupStored: false,
    backupCacheKey: '',
    savedPath: '',
    savedAt: null
};

async function downloadFileAsBase64(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('Could not download replacement video');
    }
    const blob = await response.blob();
    // Guard against oversized replacements before base64 conversion.
    if (blob.size > CONFIG.maxFileSize) {
        throw new Error('Replacement video exceeds the 15MB limit');
    }
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export class MenuManager {
    constructor({ userRole, getCurrentUser, logAudit }) {
        this.userRole = userRole;
        this.getCurrentUser = getCurrentUser || (() => null);
        this.logAudit = typeof logAudit === 'function' ? logAudit : () => {};
        this.menus = {
            spaces: [],
            collect: [],
            franchises: []
        };
        this.selectedFiles = new Map();
        this.selectedFile = null;
        this.selectionMode = false;
        this.bulkDeleteList = null;
        this.searchTerm = '';
        this.searchDebounce = null;
        this.videoPlayer = new VideoPlayer();
        this.videoObserver = null;
        this.scheduleMap = this.loadScheduleConfig();
        this.schedule = Object.values(this.scheduleMap);
        this.scheduleTimer = null;
        this.scheduleInProgress = false;
        this.init();
    }

    init() {
        this.clearSelection();
        
        this.attachEventListeners();
        this.setupSearchBar();
        this.loadAllMenus();
        this.applyPermissions();
    }

    applyPermissions() {
        const uploadBtn = document.getElementById('uploadBtn');
        const deleteBtn = document.getElementById('deleteBtn');
        const multiSelectBtn = document.getElementById('multiSelectBtn');
        const selectAllBtn = document.getElementById('selectAllBtn');
        const clearSelectionBtn = document.getElementById('clearSelectionBtn');
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        const selectionInfo = document.getElementById('selectionInfo');
        const fileSizeWarning = document.querySelector('.file-size-warning');
        const storagePanel = document.getElementById('storagePanel');
        const scheduleSection = document.getElementById('scheduleSection');
        
        if (this.userRole === 'admin' || this.userRole === 'editor') {
            uploadBtn.style.display = 'inline-block';
            deleteBtn.style.display = 'inline-block';
            if (multiSelectBtn) multiSelectBtn.style.display = 'inline-block';
            if (selectAllBtn) selectAllBtn.style.display = 'inline-block';
            if (clearSelectionBtn) clearSelectionBtn.style.display = 'inline-block';
            if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'inline-block';
            if (selectionInfo) selectionInfo.style.display = 'none';
            if (fileSizeWarning) {
                fileSizeWarning.style.display = 'block';
            }
            if (storagePanel) {
                storagePanel.style.display = this.userRole === 'admin' ? storagePanel.style.display : 'none';
            }
            if (scheduleSection) {
                scheduleSection.style.display = 'none';
            }
        } else {
            uploadBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
            if (multiSelectBtn) multiSelectBtn.style.display = 'none';
            if (selectAllBtn) selectAllBtn.style.display = 'none';
            if (clearSelectionBtn) clearSelectionBtn.style.display = 'none';
            if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';
            if (selectionInfo) selectionInfo.style.display = 'none';
            if (fileSizeWarning) fileSizeWarning.style.display = 'none';
            if (storagePanel) storagePanel.style.display = 'none';
            if (scheduleSection) {
                scheduleSection.style.display = 'none';
            }
        }
    }

    attachEventListeners() {
        if (this.userRole === 'admin' || this.userRole === 'editor') {
            document.getElementById('uploadBtn').onclick = () => this.triggerFileUpload();
            document.getElementById('fileInput').onchange = (e) => this.handleFileUpload(e);
            document.getElementById('deleteBtn').onclick = () => this.handleDelete();
        }

        const multiSelectBtn = document.getElementById('multiSelectBtn');
        if (multiSelectBtn) {
            multiSelectBtn.onclick = () => this.toggleSelectionMode();
        }

        const selectAllBtn = document.getElementById('selectAllBtn');
        if (selectAllBtn) {
            selectAllBtn.onclick = () => this.selectAllVisible();
        }

        const clearSelectionBtn = document.getElementById('clearSelectionBtn');
        if (clearSelectionBtn) {
            clearSelectionBtn.onclick = () => this.clearSelection();
        }

        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDeleteBtn) {
            bulkDeleteBtn.onclick = () => this.handleBulkDelete();
        }
        
        document.getElementById('refreshBtn').onclick = () => this.loadAllMenus();
        document.getElementById('closeVideoBtn').onclick = () => this.videoPlayer.close();
        document.getElementById('confirmReplaceBtn').onclick = () => this.startReplacement();
        document.getElementById('cancelUploadBtn').onclick = () => this.closeUploadModal();
        
        // Delete modal event listeners
        document.getElementById('cancelDeleteBtn').onclick = () => this.closeDeleteModal();
        document.getElementById('confirmDeleteBtn').onclick = () => this.confirmDelete();
    }

    setupSearchBar() {
        const searchInput = document.getElementById('menuSearch');
        if (!searchInput) return;
        
        searchInput.value = '';
        searchInput.addEventListener('input', (e) => {
            const value = (e.target.value || '').trim();
            if (this.searchDebounce) clearTimeout(this.searchDebounce);
            this.searchDebounce = setTimeout(() => {
                this.searchTerm = value;
                this.applySearchFilter();
            }, 120);
        });
    }

    escapeHtml(text) {
        return (text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        const multiSelectBtn = document.getElementById('multiSelectBtn');
        if (multiSelectBtn) {
            multiSelectBtn.textContent = `Multi-Select: ${this.selectionMode ? 'On' : 'Off'}`;
        }
        if (!this.selectionMode && this.selectedFiles.size > 1) {
            const first = this.getSelectedList()[0];
            this.clearSelection();
            if (first) {
                this.addSelection(first.path, first.name, first.folder);
            }
        }
        this.updateSelectionUI();
    }

    getSelectedList() {
        return Array.from(this.selectedFiles.values());
    }

    addSelection(filePath, fileName, folder) {
        this.selectedFiles.set(filePath, { path: filePath, name: fileName, folder });
        const cardElement = document.getElementById(`card-${filePath}`);
        if (cardElement) {
            cardElement.classList.add('selected');
        }
    }

    removeSelection(filePath) {
        this.selectedFiles.delete(filePath);
        const cardElement = document.getElementById(`card-${filePath}`);
        if (cardElement) {
            cardElement.classList.remove('selected');
        }
    }

    updateSelectionUI() {
        const selectionInfo = document.getElementById('selectionInfo');
        const selectedFileName = document.getElementById('selectedFileName');
        const uploadBtn = document.getElementById('uploadBtn');
        const deleteBtn = document.getElementById('deleteBtn');
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

        const selectedCount = this.selectedFiles.size;
        if (selectedCount === 0) {
            this.selectedFile = null;
            if (selectionInfo) selectionInfo.style.display = 'none';
            if (uploadBtn) uploadBtn.disabled = true;
            if (deleteBtn) deleteBtn.disabled = true;
            if (bulkDeleteBtn) bulkDeleteBtn.disabled = true;
            return;
        }

        const selectedList = this.getSelectedList();
        this.selectedFile = selectedCount === 1 ? selectedList[0] : null;

        if (selectionInfo && selectedFileName) {
            selectionInfo.style.display = 'block';
            if (selectedCount === 1) {
                selectedFileName.textContent = `Selected: ${this.selectedFile.name}`;
            } else {
                selectedFileName.textContent = `Selected: ${selectedCount} files`;
            }
        }

        if (uploadBtn) uploadBtn.disabled = selectedCount !== 1;
        if (deleteBtn) deleteBtn.disabled = selectedCount !== 1;
        if (bulkDeleteBtn) bulkDeleteBtn.disabled = selectedCount === 0;
    }

    handleCardClick(event, filePath, fileName, folder) {
        if (this.userRole === 'viewer') return;
        const allowMulti = this.selectionMode || (event && (event.ctrlKey || event.metaKey));

        if (!allowMulti) {
            this.clearSelection();
        }

        if (this.selectedFiles.has(filePath)) {
            if (allowMulti || this.selectedFiles.size > 1) {
                this.removeSelection(filePath);
            }
        } else {
            this.addSelection(filePath, fileName, folder);
        }

        this.updateSelectionUI();
    }

    selectAllVisible() {
        if (this.userRole === 'viewer') return;
        const cards = Array.from(document.querySelectorAll('.menu-card:not(.hidden-search)'));
        if (cards.length === 0) return;
        this.selectionMode = true;
        const multiSelectBtn = document.getElementById('multiSelectBtn');
        if (multiSelectBtn) {
            multiSelectBtn.textContent = 'Multi-Select: On';
        }
        cards.forEach(card => {
            const path = card.dataset.path;
            const name = card.dataset.filename;
            const folder = card.dataset.section;
            if (path && name && folder) {
                this.addSelection(path, name, folder);
            }
        });
        this.updateSelectionUI();
    }

    formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 MB';
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    updateStorageUsage() {
        const panel = document.getElementById('storagePanel');
        if (!panel) return;
        if (this.userRole !== 'admin') {
            panel.style.display = 'none';
            return;
        }

        const folders = [
            { key: 'spaces', labelEl: 'storageSpacesValue', fillEl: 'storageSpacesFill' },
            { key: 'collect', labelEl: 'storageCollectValue', fillEl: 'storageCollectFill' },
            { key: 'franchises', labelEl: 'storageFranchisesValue', fillEl: 'storageFranchisesFill' }
        ];

        const totals = folders.map(folder => {
            const items = this.menus[folder.key] || [];
            const size = items.reduce((sum, item) => sum + (item.size || 0), 0);
            return { key: folder.key, count: items.length, size };
        });

        const totalSize = totals.reduce((sum, item) => sum + item.size, 0);
        const totalEl = document.getElementById('storageTotal');
        if (totalEl) {
            totalEl.textContent = `${this.formatFileSize(totalSize)}`;
        }

        totals.forEach((item, idx) => {
            const folder = folders[idx];
            const labelEl = document.getElementById(folder.labelEl);
            const fillEl = document.getElementById(folder.fillEl);
            if (labelEl) {
                labelEl.textContent = `${item.count} files · ${this.formatFileSize(item.size)}`;
            }
            if (fillEl) {
                const percent = totalSize > 0 ? Math.round((item.size / totalSize) * 100) : 0;
                fillEl.style.width = `${percent}%`;
            }
        });

        panel.style.display = 'block';
    }

    validateUploadFile(file) {
        if (!file) {
            return { ok: false, message: 'Please select a video file.' };
        }
        if (file.size <= 0) {
            return { ok: false, message: 'The selected file is empty.' };
        }
        if (file.size > CONFIG.maxFileSize) {
            return {
                ok: false,
                message: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max is 15MB.`
            };
        }
        const nameLower = (file.name || '').toLowerCase();
        if (!nameLower.endsWith('.mp4')) {
            return { ok: false, message: 'Only MP4 video files are supported.' };
        }
        if (file.type && file.type !== 'video/mp4') {
            return { ok: false, message: 'Only MP4 video files are supported.' };
        }
        return { ok: true };
    }

    applySearchFilter() {
        const query = (this.searchTerm || '').toLowerCase();
        const cards = Array.from(document.querySelectorAll('.menu-card'));
        const sectionsCount = { spaces: 0, collect: 0, franchises: 0 };
        let visibleCount = 0;

        cards.forEach(card => {
            const name = card.dataset.name || '';
            const path = (card.dataset.path || '').toLowerCase();
            const matches = !query || name.includes(query) || path.includes(query);
            card.classList.toggle('hidden-search', !matches);
            if (matches) {
                visibleCount++;
                const section = card.dataset.section;
                if (section in sectionsCount) {
                    sectionsCount[section] += 1;
                }
            }
        });

        const sections = Array.from(document.querySelectorAll('.folder-section'));
        sections.forEach(section => {
            const type = section.dataset.section;
            const total = parseInt(section.dataset.total, 10) || 0;
            const visible = type && sectionsCount[type] ? sectionsCount[type] : 0;
            const countEl = section.querySelector('.section-count');
            if (countEl) {
                countEl.textContent = query ? `${visible} / ${total}` : total;
            }
            const hasCards = visible > 0 || (!query && total > 0);
            section.style.display = hasCards ? '' : 'none';
        });

        const totalCount = this.menus.spaces.length + this.menus.collect.length + this.menus.franchises.length;
        const statusEl = document.getElementById('status');
        if (statusEl) {
            if (query) {
                statusEl.textContent = `Showing ${visibleCount} of ${totalCount} menu files for "${this.searchTerm}"`;
            } else {
                statusEl.textContent = `Found ${totalCount} menu files`;
            }
        }

        if (this.selectedFiles.size > 0) {
            let selectionChanged = false;
            this.getSelectedList().forEach(selected => {
                const selectedCard = document.getElementById(`card-${selected.path}`);
                if (!selectedCard || selectedCard.classList.contains('hidden-search')) {
                    this.removeSelection(selected.path);
                    selectionChanged = true;
                } else {
                    selectedCard.classList.add('selected');
                }
            });
            if (selectionChanged) {
                this.updateSelectionUI();
            }
        }

        const content = document.getElementById('content');
        let emptyMessage = document.getElementById('searchEmptyMessage');
        const shouldShowEmpty = query && visibleCount === 0 && totalCount > 0;
        if (!emptyMessage && content) {
            emptyMessage = document.createElement('div');
            emptyMessage.id = 'searchEmptyMessage';
            emptyMessage.className = 'loading search-empty';
            emptyMessage.style.display = 'none';
            content.appendChild(emptyMessage);
        }
        if (emptyMessage) {
            if (shouldShowEmpty) {
                emptyMessage.innerHTML = `No videos match "${this.escapeHtml(this.searchTerm)}"`;
                emptyMessage.style.display = 'block';
            } else {
                emptyMessage.style.display = 'none';
            }
        }
    }

    async loadAllMenus() {
        this.clearSelection();
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'Refreshing...';
        }
        
        const content = document.getElementById('content');
        const cached = this.getMenuCache();
        const hasCached = cached && cached.menus;
        if (hasCached) {
            this.menus.spaces = cached.menus.spaces;
            this.menus.collect = cached.menus.collect;
            this.menus.franchises = cached.menus.franchises;
            this.updateStorageUsage();
            this.displayMenus();
            this.renderScheduleSection();
            this.startScheduleWatcher();
            if (statusEl && cached.timestamp && Date.now() - cached.timestamp > MENU_CACHE_TTL) {
                statusEl.textContent = 'Refreshing (cached list shown)...';
            }
        }

        const wasEmpty = content.innerHTML.includes('Loading menu files');
        
        if (wasEmpty && !hasCached) {
            content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
        }

        try {
            const [spacesMenus, collectMenus, franchiseMenus] = await Promise.all([
                loadMenusFromFolder(CONFIG.folders.spaces),
                loadMenusFromFolder(CONFIG.folders.collect),
                loadMenusFromFolder(CONFIG.folders.franchises)
            ]);
            const nextMenus = {
                spaces: spacesMenus,
                collect: collectMenus,
                franchises: franchiseMenus
            };
            const shouldRender = !hasCached || !this.menusMatch(nextMenus);

            this.menus.spaces = spacesMenus;
            this.menus.collect = collectMenus;
            this.menus.franchises = franchiseMenus;

            this.saveMenuCache();
            if (shouldRender) {
                this.updateStorageUsage();
                this.displayMenus();
                this.renderScheduleSection();
                this.startScheduleWatcher();
            }
        } catch (error) {
            if (hasCached) {
                if (statusEl) {
                    statusEl.textContent = 'Refresh failed. Showing cached results.';
                }
                return;
            }
            document.getElementById('content').innerHTML = `
                <div class="error">
                    <h3>Failed to load videos</h3>
                    <p>${error.message}</p>
                    <p>Possible causes:</p>
                    <ul style="text-align: left; display: inline-block;">
                        <li>GitHub API rate limit (wait 1 hour)</li>
                        <li>Network connection issues</li>
                        <li>Repository not accessible</li>
                    </ul>
                    <button class="btn" onclick="menuManager.loadAllMenus()">Retry</button>
                </div>
            `;
        }
    }

    displayMenus() {
        let html = '';
        
        if (this.menus.spaces.length > 0) {
            html += this.createSection('Space', this.menus.spaces, 'spaces');
        }
        
        if (this.menus.collect.length > 0) {
            html += this.createSection('Collect', this.menus.collect, 'collect');
        }
        
        if (this.menus.franchises.length > 0) {
            html += this.createSection('Franchise', this.menus.franchises, 'franchises');
        }
        
        document.getElementById('content').innerHTML = html || '<div class="loading">No menus found</div>';
        this.initLazyVideos();
        this.applySearchFilter();
        this.applyCardOrientation();
    }

    applyCardOrientation() {
        const videos = Array.from(document.querySelectorAll('.menu-card .video-thumbnail video'));
        videos.forEach(video => {
            const card = video.closest('.menu-card');
            if (!card) return;

            const applyOrientation = () => {
                if (!video.videoWidth || !video.videoHeight) return;
                const isVertical = video.videoHeight > video.videoWidth;
                card.classList.toggle('vertical', isVertical);
            };

            if (video.readyState >= 1) {
                applyOrientation();
            } else {
                video.addEventListener('loadedmetadata', applyOrientation, { once: true });
            }
        });
    }

    getMenuCache() {
        try {
            const raw = localStorage.getItem(MENU_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.menus) return null;
            const menus = parsed.menus || {};
            return {
                timestamp: parsed.timestamp || 0,
                menus: {
                    spaces: Array.isArray(menus.spaces) ? menus.spaces : [],
                    collect: Array.isArray(menus.collect) ? menus.collect : [],
                    franchises: Array.isArray(menus.franchises) ? menus.franchises : []
                }
            };
        } catch (error) {
            console.warn('Failed to read menu cache', error);
            return null;
        }
    }

    saveMenuCache() {
        const payload = {
            timestamp: Date.now(),
            menus: {
                spaces: this.menus.spaces || [],
                collect: this.menus.collect || [],
                franchises: this.menus.franchises || []
            }
        };
        try {
            localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(payload));
        } catch (error) {
            console.warn('Failed to save menu cache', error);
        }
    }

    loadVideoSource(video) {
        if (!video || video.dataset.loaded) return;
        const src = video.dataset.src;
        if (!src) return;
        video.src = src;
        video.preload = 'metadata';
        video.dataset.loaded = 'true';
        video.load();
    }

    initLazyVideos() {
        const videos = Array.from(document.querySelectorAll('.menu-card .video-thumbnail video'));
        if (videos.length === 0) return;

        if (this.videoObserver) {
            this.videoObserver.disconnect();
            this.videoObserver = null;
        }

        if (!('IntersectionObserver' in window)) {
            videos.forEach(video => this.loadVideoSource(video));
            return;
        }

        this.videoObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                this.loadVideoSource(entry.target);
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '200px 0px' });

        videos.forEach(video => {
            if (!video.dataset.loaded) {
                this.videoObserver.observe(video);
            }
        });
    }

    menusMatch(nextMenus) {
        const buildIndex = (list) => {
            const map = new Map();
            (list || []).forEach(item => {
                if (!item || !item.path) return;
                const sig = `${item.name || ''}|${item.sha || ''}|${item.size || 0}`;
                map.set(item.path, sig);
            });
            return map;
        };

        const current = {
            spaces: this.menus.spaces || [],
            collect: this.menus.collect || [],
            franchises: this.menus.franchises || []
        };

        const keys = ['spaces', 'collect', 'franchises'];
        return keys.every(key => {
            const currentMap = buildIndex(current[key]);
            const nextMap = buildIndex(nextMenus[key]);
            if (currentMap.size !== nextMap.size) return false;
            for (const [path, sig] of currentMap.entries()) {
                if (nextMap.get(path) !== sig) return false;
            }
            return true;
        });
    }

    createSection(title, menus, type) {
        return `
            <div class="folder-section" data-section="${type}" data-total="${menus.length}">
                <h2><span class="section-title-text">${title}</span> (<span class="section-count" data-section-count="${type}">${menus.length}</span>)</h2>
                <div class="grid">
                    ${menus.map(menu => this.createMenuCard(menu, type)).join('')}
                </div>
            </div>
        `;
    }

    createMenuCard(menu, type) {
        const clickHandler = (this.userRole === 'admin' || this.userRole === 'editor') ? `onclick="menuManager.handleCardClick(event, '${menu.path}', '${menu.name}', '${type}')"` : '';
        const lastUpdated = getLastUpdated(menu.path);
        const dataName = this.escapeHtml((menu.name || '').toLowerCase());
        const dataPath = this.escapeHtml(menu.path || '');
        
        const downloadButton = this.userRole === 'editor' || this.userRole === 'admin' ? `
            <button class="download-btn" onclick="event.stopPropagation(); menuManager.downloadVideo('${menu.download_url}', '${menu.name}')" title="Download video">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </button>
        ` : '';
        
        const infoButton = `
            <button class="info-btn" onclick="event.stopPropagation(); menuManager.showVideoInfo('${menu.download_url}', '${menu.name}', ${menu.size}, '${menu.path}')" title="Video info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
            </button>
        `;
        
        return `
            <div class="menu-card ${type}" id="card-${menu.path}" data-name="${dataName}" data-path="${dataPath}" data-filename="${this.escapeHtml(menu.name)}" data-section="${type}" ${clickHandler}>
                <div class="video-thumbnail">
                    <video preload="none" muted data-src="${menu.download_url}#t=1"></video>
                    ${downloadButton}
                    ${infoButton}
                </div>
                  <div class="video-content">
                      <div class="menu-name">${menu.name}</div>
                      <div class="menu-updated" style="font-size: 10px; color: #888; margin-top: 5px; line-height: 1.3;">
                          <strong>Last updated:</strong><br>${lastUpdated}
                      </div>
                  </div>
            </div>
        `;
    }

    loadScheduleConfig() {
        const normalizeItem = (item, key) => {
            const normalized = {
                ...DEFAULT_SCHEDULE,
                ...item,
                active: item.active || false,
                id: item.id || `sched-${key}`,
                replacementCacheKey: item.replacementCacheKey || key,
                replacementStored: item.replacementStored || !!item.replacementBase64,
                backupCacheKey: item.backupCacheKey || `${key}-backup`,
                backupStored: item.backupStored || !!item.backupBase64
            };
            if (normalized.replacementBase64 && normalized.replacementCacheKey) {
                ReplacementCache.save(normalized.replacementCacheKey, normalized.replacementBase64)
                    .then(saved => { normalized.replacementStored = !!saved; })
                    .catch(() => { normalized.replacementStored = false; });
                normalized.replacementBase64 = null;
            }
            if (normalized.backupBase64 && normalized.backupCacheKey) {
                ReplacementCache.save(normalized.backupCacheKey, normalized.backupBase64)
                    .then(saved => { normalized.backupStored = !!saved; })
                    .catch(() => { normalized.backupStored = false; });
                normalized.backupBase64 = null;
            }
            return normalized;
        };

        try {
            const stored = localStorage.getItem(SCHEDULE_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && typeof parsed === 'object') {
                    // If legacy array, convert to map
                    if (Array.isArray(parsed)) {
                        const map = {};
                        parsed.forEach(item => {
                            const key = item.savedPath || item.targetPath || item.id || `legacy-${Date.now()}`;
                            map[key] = normalizeItem(item, key);
                        });
                        return map;
                    }
                    // Already a map, normalize defaults
                    Object.keys(parsed).forEach(k => {
                        parsed[k] = normalizeItem(parsed[k], k);
                    });
                    return parsed;
                }
            }
        } catch (error) {
            console.warn('Failed to load saved schedule, using defaults', error);
        }
        return {};
    }

    saveScheduleConfig() {
        const persistable = {};
        
        Object.entries(this.scheduleMap).forEach(([key, item]) => {
            if (!item) return;
            item.replacementCacheKey = item.replacementCacheKey || key;
            item.replacementStored = !!item.replacementStored;
            item.backupCacheKey = item.backupCacheKey || `${key}-backup`;
            item.backupStored = !!item.backupStored;
            
            const copy = { ...item };
            
            if (copy.replacementBase64) {
                ReplacementCache.save(copy.replacementCacheKey, copy.replacementBase64)
                    .then(saved => { item.replacementStored = !!saved; })
                    .catch(() => { item.replacementStored = false; });
                copy.replacementBase64 = null;
            }
            
            if (copy.backupBase64) {
                const backupKey = copy.backupCacheKey || `${key}-backup`;
                ReplacementCache.save(backupKey, copy.backupBase64)
                    .then(saved => { item.backupStored = !!saved; })
                    .catch(() => { item.backupStored = false; });
                copy.backupBase64 = null;
            }
            
            persistable[key] = {
                ...DEFAULT_SCHEDULE,
                ...copy
            };
        });
        
        try {
            localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(persistable));
        } catch (error) {
            console.error('Failed to save schedule config', error);
            showNotification('Save failed', 'Could not save the schedule locally. Try clearing old schedules or use a smaller swap-in video.');
        }
        
        this.schedule = Object.values(this.scheduleMap);
    }

    getFolderOptions() {
        return [
            { value: CONFIG.folders.spaces, label: 'Space' },
            { value: CONFIG.folders.collect, label: 'Collect' },
            { value: CONFIG.folders.franchises, label: 'Franchise' }
        ];
    }

    getVideosForFolder(folderPath) {
        if (folderPath === CONFIG.folders.spaces) {
            return this.menus.spaces;
        }
        if (folderPath === CONFIG.folders.collect) {
            return this.menus.collect;
        }
        if (folderPath === CONFIG.folders.franchises) {
            return this.menus.franchises;
        }
        return [];
    }

    findVideoByPath(path) {
        const allMenus = [...this.menus.spaces, ...this.menus.collect, ...this.menus.franchises];
        return allMenus.find(menu => menu.path === path);
    }

    createSchedule(path) {
        return {
            ...DEFAULT_SCHEDULE,
            id: `sched-${path || Date.now()}`,
            targetPath: path || '',
            replacementCacheKey: path || '',
            backupCacheKey: path ? `${path}-backup` : '',
            savedPath: '',
            savedAt: null,
            days: []
        };
    }

    getFolderFromPath(path) {
        if (!path || !path.includes('/')) return '';
        const parts = path.split('/');
        parts.pop();
        return parts.join('/');
    }

    buildScheduleCard(item, index) {
        // Schedule section is hidden; keep function stubbed for compatibility
        return '';
    }

    renderScheduleSection() {
        const section = document.getElementById('scheduleSection');
        const cardsContainer = document.getElementById('scheduleCards');
        if (!section || !cardsContainer) return;
        
        if (this.userRole === 'viewer') {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        cardsContainer.innerHTML = this.schedule.map((item, index) => this.buildScheduleCard(item, index)).join('');
        this.attachScheduleEvents();
        
        const today = DAYS_OF_WEEK[new Date().getDay()];
        const upcoming = this.schedule.find(item => (item.days || []).includes(today) && item.targetPath && item.replacementPath);
        if (upcoming) {
            this.updateScheduleStatus(`Next swap: ${today} at ${upcoming.time}`);
        } else {
            this.updateScheduleStatus('No scheduled swap set for today');
        }
    }

renderInfoScheduleForm(path, folder, filename, previewUrl) {
        const formDays = document.getElementById('infoScheduleDays');
        const uploadBtnPreview = document.getElementById('infoScheduleUploadBtnPreview');
        const uploadBtn = uploadBtnPreview || document.getElementById('infoScheduleUploadBtn');
        const uploadInput = document.getElementById('infoScheduleUploadInput');
        const uploadStatus = document.getElementById('infoScheduleUploadStatus');
        const saveBtn = document.getElementById('infoScheduleSave');
        const runBtn = document.getElementById('infoScheduleRun');
        const clearBtn = document.getElementById('infoScheduleClear');
        const status = document.getElementById('infoScheduleStatus');
        const summary = document.getElementById('infoScheduleSummary');
        const banner = document.getElementById('infoScheduleBanner');
        const stepDays = document.getElementById('stepDays');
        const stepUpload = document.getElementById('stepUpload');
        const stepSave = document.getElementById('stepSave');
        if (!formDays || !uploadBtn || !uploadInput || !uploadStatus || !saveBtn || !runBtn || !clearBtn || !status) return;
        
        const scheduleItem = this.scheduleMap[path] || this.createSchedule(path);
        this.scheduleMap[path] = scheduleItem;
        scheduleItem.replacementCacheKey = scheduleItem.replacementCacheKey || path;
        const selectedDays = scheduleItem.days || [];
        const isSavedForThis = () => scheduleItem.savedPath === path && !!scheduleItem.savedAt;

        const preview = document.getElementById('infoSchedulePreview');
        const previewFallback = document.getElementById('infoSchedulePreviewFallback');
        const previewContainer = preview ? preview.closest('.schedule-preview') : null;

        const updatePreviewOrientation = () => {
            if (!preview || !previewContainer || !preview.videoWidth || !preview.videoHeight) return;
            const isPortrait = preview.videoHeight > preview.videoWidth;
            previewContainer.classList.toggle('is-portrait', isPortrait);
        };

        if (preview) {
            preview.onloadedmetadata = updatePreviewOrientation;
        }

        const setPreview = (src) => {
            if (!preview) return;
            if (src) {
                preview.src = src;
                preview.style.display = 'block';
                if (previewFallback) previewFallback.style.display = 'none';
                preview.load();
                preview.play().catch(() => {});
            } else {
                preview.pause();
                preview.removeAttribute('src');
                while (preview.firstChild) {
                    preview.removeChild(preview.firstChild);
                }
                preview.style.display = 'none';
                if (previewContainer) {
                    previewContainer.classList.remove('is-portrait');
                }
                if (previewFallback) previewFallback.style.display = 'block';
                if (uploadBtnPreview) uploadBtnPreview.style.display = 'inline-block';
            }
        };
        
        if (scheduleItem.replacementBase64 && isSavedForThis()) {
            setPreview(`data:video/mp4;base64,${scheduleItem.replacementBase64}`);
        } else {
            setPreview('');
        }
        
        
        formDays.innerHTML = DISPLAY_DAYS.map(day => `
            <label class="day-chip">
                <input type="checkbox" value="${day}" ${selectedDays.includes(day) ? 'checked' : ''}>
                <span>${day.slice(0,3)}</span>
            </label>
        `).join('');
        
        const setUploadStatus = (text, tone = 'muted') => {
            const colors = { success: '#28a745', warning: '#dc3545', muted: '#666', info: '#17a2b8' };
            uploadStatus.textContent = text;
            uploadStatus.style.color = colors[tone] || colors.muted;
        };
        
        if ((scheduleItem.replacementBase64 || scheduleItem.replacementStored) && scheduleItem.replacementName && isSavedForThis()) {
            setUploadStatus(`Ready: ${scheduleItem.replacementName}`, 'success');
        } else {
            setUploadStatus('No file chosen');
        }

        const loadCachedReplacement = async () => {
            if (!scheduleItem.replacementStored || scheduleItem.replacementBase64) return;
            try {
                const cached = await ReplacementCache.get(scheduleItem.replacementCacheKey || path);
                if (cached) {
                    scheduleItem.replacementBase64 = cached;
                    setPreview(`data:video/mp4;base64,${cached}`);
                    setUploadStatus(`Ready: ${scheduleItem.replacementName || 'swap video'}`, 'success');
                    updateUI();
                } else {
                    scheduleItem.replacementStored = false;
                    setUploadStatus('Swap file missing. Upload again.', 'warning');
                    updateUI();
                }
            } catch (err) {
                console.error('Failed to load cached replacement', err);
                scheduleItem.replacementStored = false;
                setUploadStatus('Swap file unavailable. Upload again.', 'warning');
                updateUI();
            }
        };
        
        const setStatus = (text, tone = 'muted') => {
            const colors = { success: '#28a745', warning: '#dc3545', info: '#17a2b8', muted: '#666' };
            status.textContent = text;
            status.style.color = colors[tone] || colors.muted;
        };

        const setSummary = (text, tone = 'info') => {
            if (!summary) return;
            const colors = { success: '#1a6ad9', info: '#1a6ad9', warning: '#dc3545', muted: '#666' };
            summary.textContent = text;
            summary.style.color = colors[tone] || colors.info;
        };

        const setBanner = (text, tone = 'info') => {
            if (!banner) return;
            const colors = { success: '#e7f7ed', info: '#f0f7ff', warning: '#ffe0e0' };
            const borders = { success: '#28a745', info: '#1a6ad9', warning: '#dc3545' };
            banner.textContent = text;
            banner.style.background = colors[tone] || colors.info;
            banner.style.borderColor = borders[tone] || borders.info;
            banner.style.color = '#1a1a1a';
        };

        const toggleStep = (el, done) => {
            if (!el) return;
            el.classList.toggle('done', !!done);
        };

        const updateUI = () => {
            const currentDays = collectDays();
            const hasDays = currentDays.length > 0;
            const hasUpload = !!scheduleItem.replacementBase64 || !!scheduleItem.replacementStored;
            const savedDays = scheduleItem.days || [];
            const isSaved = hasUpload && savedDays.length > 0;
            const daysText = savedDays.length ? savedDays.join(', ') : (hasDays ? currentDays.join(', ') : 'No days');

            toggleStep(stepDays, hasDays);
            toggleStep(stepUpload, hasUpload);
            toggleStep(stepSave, isSaved);

            saveBtn.disabled = !(hasDays && hasUpload);
            runBtn.disabled = !(hasDays && hasUpload);

            const lastRun = scheduleItem.lastRunDate ? new Date(scheduleItem.lastRunDate).toLocaleString() : 'Never';
            const activeUntil = scheduleItem.activeUntil ? new Date(scheduleItem.activeUntil).toLocaleString() : null;

            if (isSaved) {
                const activeText = activeUntil ? ` | Active until ${activeUntil}` : '';
                setSummary(`Scheduled for: ${daysText} | Last run: ${lastRun}${activeText}`, 'success');
                setBanner('Scheduled and ready', 'success');
                setStatus('Ready. Press Run now to swap.', 'info');
            } else {
                setSummary('Not scheduled', 'muted');
                setBanner('Complete the steps to schedule this video', 'info');
                if (!hasDays) {
                    setStatus('Pick at least one rollout day', 'warning');
                } else if (!hasUpload) {
                    setStatus('Add a swap-in video to continue', 'warning');
                } else {
                    setStatus('Save to finalize this schedule', 'info');
                }
            }
        };
        
        const collectDays = () => {
            return Array.from(formDays.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        };
        
        uploadBtn.onclick = () => uploadInput.click();
        uploadInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > CONFIG.maxFileSize) {
                setUploadStatus(`Too large: ${(file.size/1024/1024).toFixed(1)} MB (max 15MB)`, 'warning');
                uploadInput.value = '';
                return;
            }
            try {
                setUploadStatus('Loading...', 'info');
                const base64 = await fileToBase64(file);
                const cacheKey = scheduleItem.replacementCacheKey || path || scheduleItem.id;
                let cached = false;
                try {
                    const saved = await ReplacementCache.save(cacheKey, base64);
                    cached = !!saved;
                    if (cached) {
                        scheduleItem.replacementStored = true;
                        scheduleItem.replacementCacheKey = cacheKey;
                    } else {
                        scheduleItem.replacementStored = false;
                    }
                } catch (cacheErr) {
                    console.warn('Failed to persist swap video to cache', cacheErr);
                    scheduleItem.replacementStored = false;
                }
                scheduleItem.replacementBase64 = base64;
                scheduleItem.replacementName = file.name;
                scheduleItem.replacementPath = '';
                scheduleItem.targetPath = path;
                const readyLabel = cached ? `Ready: ${file.name}` : `Ready: ${file.name} (will clear if you close this tab)`;
                setUploadStatus(readyLabel, cached ? 'success' : 'warning');
                setPreview(`data:video/mp4;base64,${base64}`);
            } catch (err) {
                console.error('Upload failed', err);
                setUploadStatus('Upload failed', 'warning');
                scheduleItem.replacementStored = false;
                scheduleItem.replacementBase64 = null;
            }
            uploadInput.value = '';
            updateUI();
        };

        formDays.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.onchange = () => updateUI();
        });

        const clearSchedule = () => {
            setStatus('Clearing...', 'info');
            const cacheKey = scheduleItem.replacementCacheKey || path;
            const backupKey = scheduleItem.backupCacheKey || `${path}-backup`;
            delete this.scheduleMap[path];
            Object.assign(scheduleItem, this.createSchedule(path));
            this.saveScheduleConfig();
            formDays.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            setPreview('');
            setUploadStatus('No file chosen', 'muted');
            setSummary('Not scheduled', 'muted');
            setBanner('Schedule cleared. Pick days and upload to start.', 'info');
            setStatus('Schedule cleared', 'info');
            scheduleItem.active = false;
            scheduleItem.replacementStored = false;
            scheduleItem.replacementBase64 = null;
            scheduleItem.backupStored = false;
            scheduleItem.backupBase64 = null;
            if (backupKey) {
                ReplacementCache.remove(backupKey).catch(() => {});
            }
            if (cacheKey) {
                ReplacementCache.remove(cacheKey).catch(() => {});
            }
            if (uploadBtnPreview) {
                uploadBtnPreview.style.display = 'inline-block';
            }
            updateUI();
        };
        
        const persistSchedule = () => {
            const chosenDays = collectDays();
            if (!chosenDays.length) {
                setStatus('Select at least one day', 'warning');
                setSummary('Not scheduled', 'warning');
                scheduleItem.active = false;
                return false;
            }
            if (!scheduleItem.replacementBase64 && !scheduleItem.replacementStored) {
                setStatus('Upload a swap-in video first', 'warning');
                setSummary('Not scheduled', 'warning');
                scheduleItem.active = false;
                return false;
            }
            
            scheduleItem.days = chosenDays;
            scheduleItem.revertAfterHours = scheduleItem.revertAfterHours || 24;
            scheduleItem.folder = folder;
            scheduleItem.targetPath = path;
            scheduleItem.replacementPath = '';
            scheduleItem.replacementName = scheduleItem.replacementName || filename;
            scheduleItem.savedPath = path;
            scheduleItem.savedAt = new Date().toISOString();
            scheduleItem.activeUntil = null;
            scheduleItem.backupBase64 = null;
            scheduleItem.backupSha = null;
            scheduleItem.backupStored = false;
            scheduleItem.backupCacheKey = scheduleItem.backupCacheKey || `${path}-backup`;
            scheduleItem.replacementCacheKey = scheduleItem.replacementCacheKey || path;
            scheduleItem.replacementStored = !!scheduleItem.replacementStored;
            scheduleItem.active = true;
            this.saveScheduleConfig();
            setStatus(`Saved: ${chosenDays.join(', ')}`, 'success');
            setSummary(`Scheduled for: ${chosenDays.join(', ')}`, 'success');
            this.updateScheduleStatus('Schedule saved', 'success');
            updateUI();
            if (uploadBtnPreview) {
                uploadBtnPreview.style.display = 'none';
            }
            return true;
        };

        saveBtn.onclick = () => {
            setStatus('Saving...', 'info');
            const ok = persistSchedule();
            if (ok) {
                setStatus('Saved schedule', 'success');
            }
        };

        runBtn.onclick = () => {
            setStatus('Preparing run...', 'info');
            if (!persistSchedule()) return;
            setStatus('Running swap...', 'info');
            this.runScheduleSwap(path, true);
        };
        
        clearBtn.onclick = () => clearSchedule();
        
        if (scheduleItem.days?.length) {
            setStatus(`Scheduled: ${scheduleItem.days.join(', ')}`, 'info');
            setSummary(`Scheduled for: ${scheduleItem.days.join(', ')}`, 'success');
        } else {
            setStatus('Not scheduled');
            setSummary('Not scheduled', 'muted');
        }

        loadCachedReplacement();
        updateUI();
    }

    attachScheduleEvents() {
        const saveBtn = document.getElementById('saveScheduleBtn');
        const runTodayBtn = document.getElementById('runTodayScheduleBtn');
        
        if (saveBtn) {
            saveBtn.onclick = () => {
                this.saveScheduleConfig();
                this.updateScheduleStatus('Schedule saved', 'success');
            };
        }
        
        if (runTodayBtn) {
            runTodayBtn.onclick = () => this.runTodaysSchedule();
        }
        
        document.querySelectorAll('.schedule-card').forEach(card => {
            const index = parseInt(card.getAttribute('data-index'));
            const scheduleItem = this.schedule[index];
            if (!scheduleItem) return;
            
            card.querySelector('.schedule-day').onchange = (e) => {
                scheduleItem.days = [e.target.value];
                this.saveScheduleConfig();
            };
            
            card.querySelector('.schedule-time').onchange = (e) => {
                scheduleItem.time = e.target.value || '09:00';
                this.saveScheduleConfig();
            };
            
            card.querySelector('.schedule-folder').onchange = (e) => {
                scheduleItem.folder = e.target.value;
                scheduleItem.targetPath = '';
                scheduleItem.replacementPath = '';
                scheduleItem.backupBase64 = null;
                scheduleItem.backupSha = null;
                scheduleItem.activeUntil = null;
                this.saveScheduleConfig();
                this.renderScheduleSection();
            };
            
            card.querySelector('.schedule-target').onchange = (e) => {
                scheduleItem.targetPath = e.target.value;
                this.saveScheduleConfig();
            };
            
            card.querySelector('.schedule-replacement').onchange = (e) => {
                scheduleItem.replacementPath = e.target.value;
                this.saveScheduleConfig();
            };
            
            const revertSelect = card.querySelector('.schedule-revert-after');
            if (revertSelect) {
                revertSelect.onchange = (e) => {
                    scheduleItem.revertAfterHours = parseInt(e.target.value, 10) || 24;
                    this.saveScheduleConfig();
                };
            }
            
            card.querySelector('.schedule-run-btn').onclick = () => this.runScheduleSwap(index, true);
        });
    }

    updateScheduleStatus(message, tone = 'muted') {
        const status = document.getElementById('scheduleStatus');
        if (!status) return;
        
        const colors = {
            success: '#28a745',
            warning: '#dc3545',
            info: '#17a2b8',
            muted: '#666'
        };
        
        status.textContent = message;
        status.style.color = colors[tone] || colors.muted;
    }

    startScheduleWatcher() {
        if (this.userRole === 'viewer') return;
        if (!this.scheduleTimer) {
            this.scheduleTimer = setInterval(() => this.checkSchedules(), 60000);
        }
        this.checkSchedules();
    }

    async checkSchedules() {
        if (this.userRole === 'viewer' || this.scheduleInProgress) return;
        
        const now = new Date();
        const entries = Object.entries(this.scheduleMap || {});
        
        for (const [key, item] of entries) {
            if (!item) continue;
            if (!item.active) continue;
            // Auto revert if needed
            if (item.activeUntil) {
                if (!item.backupBase64 && item.backupStored && item.backupCacheKey) {
                    try {
                        item.backupBase64 = await ReplacementCache.get(item.backupCacheKey);
                    } catch (err) {
                        console.warn('Failed to load backup for scheduled revert', err);
                        item.backupBase64 = null;
                    }
                }
                if (!item.backupBase64) {
                    item.activeUntil = null;
                    this.saveScheduleConfig();
                    continue;
                }
                const activeUntil = new Date(item.activeUntil);
                  if (now >= activeUntil) {
                      await this.revertSwap(key);
                      continue;
                  }
              }
              // Manual-only mode: do not auto-run swaps; user must press Run now
          }
      }

    async runScheduleSwap(key, manualTrigger = false) {
        if (this.scheduleInProgress) return;
        
        const scheduleItem = this.scheduleMap[key];
        if (!scheduleItem) return;
        
        if (!scheduleItem.replacementBase64 && scheduleItem.replacementStored && scheduleItem.replacementCacheKey) {
            try {
                const cached = await ReplacementCache.get(scheduleItem.replacementCacheKey);
                if (cached) {
                    scheduleItem.replacementBase64 = cached;
                } else {
                    scheduleItem.replacementStored = false;
                }
            } catch (err) {
                console.error('Failed to load cached swap video', err);
                scheduleItem.replacementStored = false;
            }
        }
        
        if (!scheduleItem.targetPath || (!scheduleItem.replacementBase64 && !scheduleItem.replacementPath && !scheduleItem.replacementStored)) {
            this.updateScheduleStatus('Complete target and upload a swap-in video before swapping', 'warning');
            return;
        }
            if (scheduleItem.replacementPath && !scheduleItem.replacementBase64 && scheduleItem.targetPath === scheduleItem.replacementPath) {
                this.updateScheduleStatus('Select different videos to perform a swap', 'warning');
                return;
            }
        
        const targetVideo = this.findVideoByPath(scheduleItem.targetPath);
        const replacementVideo = scheduleItem.replacementPath ? this.findVideoByPath(scheduleItem.replacementPath) : null;
        
        if (!targetVideo) {
            this.updateScheduleStatus('Target video is missing. Refresh the list.', 'warning');
            return;
        }
        if (!scheduleItem.replacementBase64 && !replacementVideo) {
            this.updateScheduleStatus('Swap-in video is missing. Upload again.', 'warning');
            return;
        }
        
        this.scheduleInProgress = true;
        this.updateScheduleStatus('Running swap...', 'info');
        
        try {
            let base64 = scheduleItem.replacementBase64;
            let replacementName = scheduleItem.replacementName;
            
            if (!base64 && replacementVideo) {
                base64 = await downloadFileAsBase64(replacementVideo.download_url);
                replacementName = replacementVideo.name;
            }
            
            const targetInfo = await getCurrentFileInfo(targetVideo.path);
            
            // Store backup for auto-revert
            scheduleItem.backupCacheKey = scheduleItem.backupCacheKey || `${key}-backup`;
            scheduleItem.backupBase64 = targetInfo.content;
            scheduleItem.backupSha = targetInfo.sha;
            scheduleItem.backupStored = false;
            
            await replaceFile(targetVideo.path, base64, replacementName || 'scheduled-swap.mp4', targetInfo.sha);
            const updatedBy = this.getCurrentUser() || 'scheduler';
            saveVideoMetadata(targetVideo.path, updatedBy, new Date().toISOString());
            
            const activeUntil = new Date(Date.now() + (scheduleItem.revertAfterHours || 24) * 60 * 60 * 1000);
            scheduleItem.activeUntil = activeUntil.toISOString();
            scheduleItem.lastRunDate = new Date().toISOString();
            this.saveScheduleConfig();
            
            this.updateScheduleStatus(`Swapped ${targetVideo.name} with ${replacementName || 'uploaded video'} (reverts at ${activeUntil.toLocaleString()})`, 'success');
            await this.loadAllMenus();
        } catch (error) {
            console.error('Scheduled swap failed', error);
            this.updateScheduleStatus(`Swap failed: ${error.message}`, 'warning');
        } finally {
            this.scheduleInProgress = false;
        }
    }

    async revertSwap(key) {
        const item = this.scheduleMap[key];
        if (!item) return;
        
        if (!item.backupBase64 && item.backupStored && item.backupCacheKey) {
            try {
                item.backupBase64 = await ReplacementCache.get(item.backupCacheKey);
            } catch (err) {
                console.warn('Failed to load cached backup for revert', err);
                item.backupBase64 = null;
            }
        }
        
        if (!item.backupBase64) return;
        
        const targetVideo = this.findVideoByPath(item.targetPath);
        if (!targetVideo) {
            this.updateScheduleStatus('Revert skipped: target video missing. Refresh.', 'warning');
            item.activeUntil = null;
            item.backupBase64 = null;
            item.backupSha = null;
            item.backupStored = false;
            if (item.backupCacheKey || key) {
                ReplacementCache.remove(item.backupCacheKey || `${key}-backup`).catch(() => {});
            }
            item.backupCacheKey = '';
            this.saveScheduleConfig();
            return;
        }
        
        try {
            const currentInfo = await getCurrentFileInfo(targetVideo.path);
            await replaceFile(targetVideo.path, item.backupBase64, targetVideo.name, currentInfo.sha);
            saveVideoMetadata(targetVideo.path, 'scheduler (revert)', new Date().toISOString());
            
            item.lastRevertDate = new Date().toISOString();
            item.activeUntil = null;
            item.backupBase64 = null;
            item.backupSha = null;
            item.backupStored = false;
            if (item.backupCacheKey || key) {
                ReplacementCache.remove(item.backupCacheKey || `${key}-backup`).catch(() => {});
            }
            item.backupCacheKey = '';
            item.replacementBase64 = null;
            item.replacementStored = false;
            if (item.replacementCacheKey || key) {
                ReplacementCache.remove(item.replacementCacheKey || key).catch(() => {});
            }
            item.replacementCacheKey = '';
            item.replacementPath = '';
            item.replacementName = '';
            item.targetPath = '';
            item.days = [];
            item.savedPath = '';
            item.savedAt = null;
            this.saveScheduleConfig();
            
            this.updateScheduleStatus(`Reverted to original ${targetVideo.name}`, 'success');
            await this.loadAllMenus();
        } catch (error) {
            console.error('Auto-revert failed', error);
            this.updateScheduleStatus(`Revert failed: ${error.message}`, 'warning');
        }
    }

    showVideoInfo(url, filename, size, path) {
        const panel = document.getElementById('videoInfoPanel');
        const content = document.getElementById('videoInfoContent');

        content.innerHTML = `
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">File Name</div>
                <div class="info-value" id="videoInfoName">Loading...</div>
            </div>
            <div class="info-item">
                <div class="info-label">Resolution</div>
                <div class="info-value" id="videoInfoResolution">Loading...</div>
            </div>
            <div class="info-item">
                <div class="info-label">Aspect Ratio</div>
                <div class="info-value" id="videoInfoAspect">Loading...</div>
            </div>
            <div class="info-item">
                <div class="info-label">Duration</div>
                <div class="info-value" id="videoInfoDuration">Loading...</div>
            </div>
            <div class="info-item">
                <div class="info-label">File Size</div>
                <div class="info-value" id="videoInfoSize">Loading...</div>
            </div>
            <div class="info-item">
                <div class="info-label">Format</div>
                <div class="info-value" id="videoInfoFormat">MP4</div>
            </div>
        </div>
        ${this.userRole !== 'viewer' ? `
        <div style="margin-top: 20px; text-align: center;">
            <button class="btn kiosk-link-btn" onclick="menuManager.copyKioskLink(event, '${url ? `https://meama24252525.github.io/Test-Menu-Apliction/links/player-${filename.replace('.mp4', '')}.html` : ''}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy Kiosk Command
            </button>
        </div>
        <div class="info-schedule-summary" id="infoScheduleSummary">Not scheduled</div>
        <div class="info-schedule">
            <h3>Schedule this video</h3>
            <div class="info-schedule-banner" id="infoScheduleBanner">Complete the steps to schedule this video</div>
            <div class="schedule-preview">
                <video id="infoSchedulePreview" muted loop playsinline preload="metadata">
                    <source src="${url}#t=1" type="video/mp4">
                </video>
                <div class="schedule-preview-fallback" id="infoSchedulePreviewFallback">
                    <button class="btn" id="infoScheduleUploadBtnPreview">Upload / Replace video</button>
                    <p class="upload-hint inline">Must be under 15MB. Larger files will be rejected.</p>
                    <input type="file" id="infoScheduleUploadInput" accept=".mp4,.mov,.avi" style="display:none;">
                    <div id="infoScheduleUploadStatus" class="upload-status">No file chosen</div>
                </div>
            </div>
            <div class="schedule-steps" id="infoScheduleSteps">
                <div class="step-item" id="stepUpload">Add swap-in video</div>
                <div class="step-item" id="stepDays">Pick rollout days</div>
                <div class="step-item" id="stepSave">Save schedule</div>
            </div>
            <div class="schedule-row">
                <label>Days to roll out</label>
                <div class="day-chip-list" id="infoScheduleDays"></div>
            </div>
            <div class="info-schedule-actions">
                <button type="button" class="btn primary" id="infoScheduleSave">Save Schedule</button>
                <button type="button" class="btn refresh" id="infoScheduleRun">Run now</button>
                <button type="button" class="btn secondary" id="infoScheduleClear">Clear</button>
            </div>
            <div class="info-schedule-status" id="infoScheduleStatus">Not scheduled</div>
        </div>
        ` : ''}
        `;
        panel.classList.add('show');
        suspendBackground(panel);
        lockScroll();
        
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.crossOrigin = 'anonymous';
        
        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        const timeout = setTimeout(() => {
            setValue('videoInfoName', filename || 'Unavailable');
            setValue('videoInfoResolution', 'Unavailable');
            setValue('videoInfoAspect', 'Unavailable');
            setValue('videoInfoDuration', 'Unavailable');
            setValue('videoInfoSize', 'Unavailable');
        }, 8000);
        
        video.onloadedmetadata = () => {
            clearTimeout(timeout);
            try {
                const duration = this.formatDuration(video.duration);
                const resolution = `${video.videoWidth} x ${video.videoHeight}`;
                const aspectRatio = this.calculateAspectRatio(video.videoWidth, video.videoHeight);
                const fileSize = (size / (1024 * 1024)).toFixed(2);
                const folder = this.getFolderFromPath(path);
                setValue('videoInfoName', filename || 'Unavailable');
                setValue('videoInfoResolution', resolution);
                setValue('videoInfoAspect', aspectRatio);
                setValue('videoInfoDuration', duration);
                setValue('videoInfoSize', `${fileSize} MB`);

                if (this.userRole !== 'viewer') {
                    this.renderInfoScheduleForm(path, folder, filename, url);
                }
            } catch (err) {
                setValue('videoInfoName', filename || 'Unavailable');
                setValue('videoInfoResolution', 'Unavailable');
                setValue('videoInfoAspect', 'Unavailable');
                setValue('videoInfoDuration', 'Unavailable');
                setValue('videoInfoSize', 'Unavailable');
            }
        };
        
        video.onerror = () => {
            clearTimeout(timeout);
            setValue('videoInfoName', filename || 'Unavailable');
            setValue('videoInfoResolution', 'Unavailable');
            setValue('videoInfoAspect', 'Unavailable');
            setValue('videoInfoDuration', 'Unavailable');
            setValue('videoInfoSize', 'Unavailable');
        };
        
        if (this.userRole !== 'viewer') {
            const folder = this.getFolderFromPath(path);
            this.renderInfoScheduleForm(path, folder, filename, url);
        }

        video.src = url + '#t=0.1';
    }

    copyKioskLink(event, link) {
        const button = event.currentTarget;
        const originalHTML = button.innerHTML;
        const originalBackground = button.style.background || '';
        
        // Prevent multiple clicks
        if (button.disabled) return;
        button.disabled = true;
        
        // Create the full Chrome kiosk command
        const fullCommand = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk --start-fullscreen --disable-infobars --noerrdialogs "${link}"`;
        
        navigator.clipboard.writeText(fullCommand).then(() => {
            // Show success feedback
            button.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Copied!
            `;
            button.style.background = '#4a90e2';
            
            // Restore original text after 2 seconds
            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.style.background = originalBackground;
                button.disabled = false;
            }, 2000);
        }).catch(err => {
            alert('Failed to copy command: ' + err.message);
            button.disabled = false;
        });
    }

        formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    calculateAspectRatio(width, height) {
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(width, height);
        return `${width / divisor}:${height / divisor}`;
    }

    downloadVideo(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    selectFile(filePath, fileName, folder) {
        if (this.userRole === 'viewer') return;

        this.clearSelection();
        this.addSelection(filePath, fileName, folder);
        this.updateSelectionUI();
    }

    clearSelection() {
        document.querySelectorAll('.menu-card').forEach(card => {
            card.classList.remove('selected');
        });

        this.selectedFiles.clear();
        this.selectedFile = null;
        this.updateSelectionUI();
    }

    triggerFileUpload() {
        if (this.userRole === 'viewer') {
            alert('You do not have permission to upload files');
            return;
        }

        if (this.selectedFiles.size !== 1 || !this.selectedFile) {
            alert('Please select exactly one file to replace');
            return;
        }
        document.getElementById('fileInput').click();
    }

    handleFileUpload(event) {
        if (this.userRole === 'viewer') return;
        
        const file = event.target.files[0];
        if (!file || !this.selectedFile) return;

        const validation = this.validateUploadFile(file);
        if (!validation.ok) {
            showNotification('Invalid File', validation.message);
            event.target.value = '';
            return;
        }
        
        document.getElementById('replaceInfo').innerHTML = `
            <p><strong>Replacing:</strong> ${this.selectedFile.name}</p>
            <p><strong>With:</strong> ${file.name}</p>
        `;
        
        this.newFile = file;
        document.getElementById('uploadOverlay').classList.add('show');
        suspendBackground(document.getElementById('uploadOverlay'));
        lockScroll();
    }

    closeUploadModal() {
        const overlay = document.getElementById('uploadOverlay');
        overlay.classList.remove('show');
        document.getElementById('fileInput').value = '';
        document.getElementById('uploadProgress').style.display = 'none';
        document.getElementById('uploadButtons').style.display = 'block';
        restoreBackground(overlay);
        unlockScroll();
    }

    async startReplacement() {
        if (this.userRole === 'viewer') {
            alert('You do not have permission to replace files');
            return;
        }
        
        if (!this.newFile || !this.selectedFile) return;
        
        document.getElementById('uploadProgress').style.display = 'block';
        document.getElementById('uploadButtons').style.display = 'none';
        
        try {
            const progressBar = document.getElementById('progressFill');
            progressBar.style.width = '33%';
            
            const base64 = await fileToBase64(this.newFile);
            progressBar.style.width = '66%';
            
            const fileInfo = await getCurrentFileInfo(this.selectedFile.path);
            await replaceFile(this.selectedFile.path, base64, this.newFile.name, fileInfo.sha);
            
            const updatedBy = this.getCurrentUser();
            saveVideoMetadata(this.selectedFile.path, updatedBy, new Date().toISOString());
            this.logAudit('replace', `Replaced ${this.selectedFile.name} with ${this.newFile.name}`);
            
            progressBar.style.width = '100%';
            document.getElementById('uploadStatus').textContent = 'Success!';
            
            setTimeout(() => {
                this.closeUploadModal();
                this.loadAllMenus();
            }, 1500);
            
        } catch (error) {
            showNotification('Replace Failed', 'Replace failed: ' + error.message);
            this.logAudit('replace', `Replace failed: ${error.message}`, { status: 'error' });
            this.closeUploadModal();
        }
    }

    showDeleteModal(list) {
        const files = list && list.length ? list : (this.selectedFile ? [this.selectedFile] : []);
        if (files.length === 0) {
            alert('Please select a file to delete first');
            return;
        }

        this.bulkDeleteList = files.length > 1 ? files : null;
        const previewNames = files.slice(0, 4).map(item => item.name).join(', ');
        const suffix = files.length > 4 ? `, and ${files.length - 4} more...` : '';
        const infoLine = files.length > 1
            ? `<p><strong>Deleting:</strong> ${files.length} files</p><p style="font-size: 12px; color: #666; margin-top: 8px;">${this.escapeHtml(previewNames)}${suffix}</p>`
            : `<p><strong>Deleting:</strong> ${this.escapeHtml(files[0].name)}</p>`;

        document.getElementById('deleteInfo').innerHTML = `
            ${infoLine}
            <p style="font-size: 12px; color: #666; margin-top: 8px;">This will also delete player HTML files.</p>
        `;
        document.getElementById('deleteOverlay').classList.add('show');
        suspendBackground(document.getElementById('deleteOverlay'));
        lockScroll();
    }

    closeDeleteModal() {
        const overlay = document.getElementById('deleteOverlay');
        overlay.classList.remove('show');
        restoreBackground(overlay);
        unlockScroll();
    }

    async handleDelete() {
        if (this.userRole === 'viewer') {
            alert('You do not have permission to delete files');
            return;
        }
        
        if (this.selectedFiles.size === 0) {
            alert('Please select a file to delete first');
            return;
        }

        if (this.selectedFiles.size > 1) {
            showNotification('Bulk Delete Available', 'Use the Bulk Delete button to remove multiple files at once.');
            return;
        }

        this.showDeleteModal([this.selectedFile]);
    }

    handleBulkDelete() {
        if (this.userRole === 'viewer') {
            alert('You do not have permission to delete files');
            return;
        }
        if (this.selectedFiles.size === 0) {
            showNotification('No Selection', 'Select one or more files to delete.');
            return;
        }
        this.showDeleteModal(this.getSelectedList());
    }

    async confirmDelete() {
        this.closeDeleteModal();

        const filesToDelete = this.bulkDeleteList && this.bulkDeleteList.length
            ? this.bulkDeleteList
            : (this.selectedFile ? [this.selectedFile] : []);
        this.bulkDeleteList = null;

        if (filesToDelete.length === 0) {
            showNotification('Nothing Selected', 'Select a file to delete.');
            return;
        }

        try {
            document.getElementById('status').textContent = 'Deleting...';

            let successCount = 0;
            let failureCount = 0;

            for (const file of filesToDelete) {
                try {
                    const fileInfo = await getCurrentFileInfo(file.path);
                    await deleteFile(file.path, fileInfo.sha, file.name);
                    await deletePlayerHTML(file.name);
                    successCount += 1;
                    this.logAudit('delete', `Deleted ${file.name}`);
                } catch (err) {
                    failureCount += 1;
                    this.logAudit('delete', `Failed to delete ${file.name}: ${err.message}`, { status: 'error' });
                }
            }

            this.clearSelection();
            await this.loadAllMenus();

            if (failureCount === 0) {
                document.getElementById('status').textContent = `Deleted ${successCount} file${successCount !== 1 ? 's' : ''}.`;
                showNotification('Delete Complete', `Deleted ${successCount} file${successCount !== 1 ? 's' : ''}.`);
            } else {
                document.getElementById('status').textContent = 'Delete completed with errors';
                showNotification('Delete Completed', `Deleted ${successCount}, failed ${failureCount}.`);
            }
        } catch (error) {
            showNotification('Delete Failed', 'Delete failed: ' + error.message);
            console.error('Delete error:', error);
            document.getElementById('status').textContent = 'Delete failed';
        }
    }
}

