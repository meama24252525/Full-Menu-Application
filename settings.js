const EDITOR_ADD_SETTING_KEY = 'editorAddVideoEnabled';

export function isEditorAddEnabled() {
    return localStorage.getItem(EDITOR_ADD_SETTING_KEY) === 'true';
}

export function setEditorAddEnabled(enabled) {
    localStorage.setItem(EDITOR_ADD_SETTING_KEY, enabled ? 'true' : 'false');
}
