let currentUser = null;
let currentRole = null;

export function setSession(user, role) {
    currentUser = user;
    currentRole = role;
}

export function clearSession() {
    currentUser = null;
    currentRole = null;
}

export function getCurrentUser() {
    return currentUser;
}

export function getCurrentRole() {
    return currentRole;
}
