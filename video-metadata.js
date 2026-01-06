const STORAGE_KEY = 'videoMetadata';

export function getVideoMetadata() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
}

export function saveVideoMetadata(path, username, timestamp) {
    const metadata = getVideoMetadata();
    metadata[path] = {
        updatedBy: username,
        updatedAt: timestamp
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
}

export function getLastUpdated(path) {
    const metadata = getVideoMetadata();
    if (metadata[path]) {
        const date = new Date(metadata[path].updatedAt);
        const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        const formattedTime = date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return `${metadata[path].updatedBy} on ${formattedDate} at ${formattedTime}`;
    }
    return 'No update info';
}
