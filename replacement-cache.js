const DB_NAME = 'menuManagerSchedule';
const STORE_NAME = 'replacements';
const DB_VERSION = 1;
let dbPromise = null;

const openDB = () => {
    // If IndexedDB is unavailable, skip caching instead of failing.
    if (!('indexedDB' in window)) {
        return Promise.resolve(null);
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
};

const save = async (id, base64) => {
    if (!id || !base64) return false;
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE_NAME).put({ id, base64, savedAt: Date.now() });
    });
};

const get = async (id) => {
    if (!id) return null;
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result ? request.result.base64 : null);
        request.onerror = () => reject(request.error);
    });
};

const remove = async (id) => {
    if (!id) return;
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE_NAME).delete(id);
    });
};

export const ReplacementCache = { save, get, remove };
