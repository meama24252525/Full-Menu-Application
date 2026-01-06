import { CONFIG } from './config.js';

export function validateVideoFile(file, contextLabel) {
    if (!file) {
        return { ok: false, message: 'Please select a video file.' };
    }

    if (file.size <= 0) {
        return { ok: false, message: 'The selected file is empty.' };
    }

    if (file.size > CONFIG.maxFileSize) {
        return {
            ok: false,
            message: `File size: ${(file.size / (1024 * 1024)).toFixed(1)} MB. Maximum allowed: 15MB.`
        };
    }

    const nameLower = (file.name || '').toLowerCase();
    if (!nameLower.endsWith('.mp4')) {
        return { ok: false, message: `${contextLabel} must be an .mp4 video.` };
    }

    if (file.type && file.type !== 'video/mp4') {
        return { ok: false, message: 'Only MP4 video files are supported.' };
    }

    return { ok: true };
}

export function validateCustomName(customName) {
    if (!customName) return { ok: true };
    if (customName.includes('.')) {
        return { ok: false, message: 'Custom name should not include a file extension.' };
    }
    if (customName.length > 60) {
        return { ok: false, message: 'Custom name must be 60 characters or fewer.' };
    }
    if (!/^[a-zA-Z0-9 _-]+$/.test(customName)) {
        return { ok: false, message: 'Custom name can only use letters, numbers, spaces, hyphens, and underscores.' };
    }
    return { ok: true };
}
