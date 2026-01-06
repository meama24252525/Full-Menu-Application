import { CONFIG } from './config.js';

// ADD YOUR GITHUB TOKEN HERE
const GITHUB_TOKEN = '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'; // Replace with your actual token

export async function loadMenusFromFolder(folderName) {
    try {
        const url = `https://api.github.com/repos/${CONFIG.username}/${CONFIG.repoName}/contents/${encodeURIComponent(folderName)}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`
            }
        });
        
        if (!response.ok) return [];
        
        const contents = await response.json();
        
        return contents
            .filter(item => item.type === 'file' && item.name.toLowerCase().endsWith('.mp4'))
            .map(item => ({
                name: item.name,
                path: item.path,
                download_url: item.download_url,
                size: item.size,
                sha: item.sha
            }));
            
    } catch (error) {
        console.error('Error loading folder:', error);
        return [];
    }
}

export async function getCurrentFileInfo(filePath) {
    const url = `https://api.github.com/repos/${CONFIG.username}/${CONFIG.repoName}/contents/${filePath}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Could not get file info: ${response.status}`);
    }
    
    return await response.json();
}

export async function replaceFile(filePath, base64Content, fileName, currentSha) {
    const url = `https://api.github.com/repos/${CONFIG.username}/${CONFIG.repoName}/contents/${filePath}`;
    
    console.log('Attempting to replace file:', filePath);
    
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Authorization': `token ${GITHUB_TOKEN}`
        },
        body: JSON.stringify({
            message: `Replace ${filePath.split('/').pop()} with ${fileName}`,
            content: base64Content,
            sha: currentSha
        })
    });
    
    console.log('GitHub API Response Status:', response.status);
    
    if (!response.ok) {
        const error = await response.json();
        console.error('GitHub API Error:', error);
        throw new Error(error.message || `Upload failed: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Upload successful:', result);
    return result;
}

export async function deleteFile(filePath, fileSha, fileName) {
    const url = `https://api.github.com/repos/${CONFIG.username}/${CONFIG.repoName}/contents/${filePath}`;
    
    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Authorization': `token ${GITHUB_TOKEN}`
        },
        body: JSON.stringify({
            message: `Delete ${fileName}`,
            sha: fileSha
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Delete failed: ${response.status}`);
    }
}

export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}
export async function createNewFile(folderPath, fileName, base64Content) {
    const filePath = `${folderPath}/${fileName}`;
    const url = `https://api.github.com/repos/${CONFIG.username}/${CONFIG.repoName}/contents/${filePath}`;
    
    console.log('Attempting to create new file:', filePath);
    
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Authorization': `token ${GITHUB_TOKEN}`
        },
        body: JSON.stringify({
            message: `Add new video: ${fileName}`,
            content: base64Content
        })
    });
    
    console.log('GitHub API Response Status:', response.status);
    
    if (!response.ok) {
        const error = await response.json();
        console.error('GitHub API Error:', error);

        const messageLower = (error.message || '').toLowerCase();
        const containsMissingSha =
            messageLower.includes('"sha" wasn\'t supplied') ||
            messageLower.includes("'sha' wasn't supplied") ||
            messageLower.includes('sha wasnt supplied') ||
            messageLower.includes('sha was not supplied') ||
            (Array.isArray(error.errors) && error.errors.some(err => err.field && err.field.toLowerCase() === 'sha'));

        if (containsMissingSha) {
            throw new Error(`File "${fileName}" already exists in this folder. Please use a different name or use the Replace feature.`);
        }

        throw new Error(error.message || `Upload failed: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Upload successful:', result);
    return result;
}

export async function uploadPlayerHTML(folderPath, fileName, htmlContent) {
    const playerFileName = `player-${fileName.replace('.mp4', '')}.html`;
    const filePath = `links/${playerFileName}`;
    const url = `https://api.github.com/repos/${CONFIG.username}/${CONFIG.repoName}/contents/${filePath}`;
    
    console.log('Uploading player HTML:', filePath);
    
    // Convert HTML string to base64 for GitHub contents API.
    const base64Content = btoa(unescape(encodeURIComponent(htmlContent)));
    
    const uploadRequest = async (sha) => {
        const body = {
            message: `Add player HTML for ${fileName}`,
            content: base64Content
        };
        if (sha) {
            body.sha = sha;
            body.message = `Update player HTML for ${fileName}`;
        }
        
        return await fetch(url, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Authorization': `token ${GITHUB_TOKEN}`
            },
            body: JSON.stringify(body)
        });
    };
    
    let response = await uploadRequest();
    console.log('Player HTML upload status:', response.status);
    
    if (!response.ok) {
        const error = await response.json();
        console.error('Player HTML upload error:', error);
        
        const messageLower = (error.message || '').toLowerCase();
        const containsMissingSha =
            messageLower.includes('"sha" wasn\'t supplied') ||
            messageLower.includes("'sha' wasn't supplied") ||
            messageLower.includes('sha wasnt supplied') ||
            messageLower.includes('sha was not supplied') ||
            (Array.isArray(error.errors) && error.errors.some(err => err.field && err.field.toLowerCase() === 'sha'));
        
        // Missing sha means the file already exists; fetch sha and retry.
        if (containsMissingSha) {
            const existingFile = await getCurrentFileInfo(filePath);
            response = await uploadRequest(existingFile.sha);
        } else {
            throw new Error(error.message || `Player upload failed: ${response.status}`);
        }
    }
    
    if (!response.ok) {
        const error = await response.json();
        console.error('Player HTML upload error (retry):', error);
        throw new Error(error.message || `Player upload failed: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Player HTML uploaded successfully:', result);
    return result;
}

export async function deletePlayerHTML(fileName) {
    const playerFileName = `player-${fileName.replace('.mp4', '')}.html`;
    const filePath = `links/${playerFileName}`;
    const url = `https://api.github.com/repos/${CONFIG.username}/${CONFIG.repoName}/contents/${filePath}`;
    
    console.log('Checking player HTML for deletion:', filePath);
    
    try {
        // First, get the file to get its SHA
        const getResponse = await fetch(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`
            }
        });
        
        if (!getResponse.ok) {
            console.log('Player HTML not found (may not exist):', filePath);
            return; // Player HTML might not exist, that's okay
        }
        
        const fileInfo = await getResponse.json();
        
        // Now delete it
        const deleteResponse = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Authorization': `token ${GITHUB_TOKEN}`
            },
            body: JSON.stringify({
                message: `Delete player HTML for ${fileName}`,
                sha: fileInfo.sha
            })
        });
        
        if (!deleteResponse.ok) {
            const error = await deleteResponse.json();
            console.error('Player HTML deletion error:', error);
            throw new Error(error.message || `Player deletion failed: ${deleteResponse.status}`);
        }
        
        console.log('Player HTML deleted successfully:', filePath);
    } catch (error) {
        console.warn('Could not delete player HTML:', error.message);
        // Don't throw - player HTML deletion is optional
    }
}
