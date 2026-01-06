export function generatePlayerHTML(folderPath, fileName, monitorType) {
    const baseURL = 'https://meama24252525.github.io/Test-Menu-Apliction';
    const videoURL = `${baseURL}/${folderPath}/${encodeURIComponent(fileName)}`;

    const title = getMonitorTitle(folderPath);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  html, body { margin:0; height:100%; overflow:hidden; background:black; }
  video { width:100vw; height:100vh; object-fit:cover; background:black; }
</style>
</head>
<body>
<video id="vid" autoplay loop muted playsinline>
  <source src="${videoURL}" type="video/mp4">
</video>
<script>
const vid = document.getElementById("vid");
vid.play().catch(()=>{});
setTimeout(()=>{ document.documentElement.requestFullscreen().catch(()=>{}); },1000);

function applyOrientation() {
  if (!vid.videoWidth || !vid.videoHeight) return;
  const isPortrait = vid.videoHeight > vid.videoWidth;
  vid.style.objectFit = isPortrait ? "contain" : "cover";
}

vid.addEventListener("loadedmetadata", applyOrientation);

let lastETag = null;
const videoURL = "${videoURL}";

async function checkUpdate() {
  try {
    const res = await fetch(videoURL, { method: 'HEAD', cache:'no-store' });
    const etag = res.headers.get('ETag');
    if (etag && lastETag && etag !== lastETag) {
      const newSrc = videoURL + "?v=" + new Date().getTime();
      vid.src = newSrc;
      vid.load();
      vid.play();
      console.log("Video updated:", newSrc);
    }
    lastETag = etag;
  } catch(e){ console.warn(e); }
}

setInterval(checkUpdate, 10000);
</script>
</body>
</html>`;
}

function getMonitorTitle(folderPath) {
    if (folderPath === 'spaces') return 'Space Player';
    if (folderPath === 'collects') return 'Collect Player';
    if (folderPath === 'franchises') return 'Franchise Player';
    if (folderPath === '1') return 'Single Monitor Player';
    if (folderPath === '2/menu1') return 'Dual Monitor 1 (First Monitor)';
    if (folderPath === '2/menu2') return 'Dual Monitor 2 (Second Monitor)';
    if (folderPath === 'vertical/monitor 1') return 'Vertical Monitor 1';
    if (folderPath === 'vertical/monitor 2') return 'Vertical Monitor 2';
    return 'Video Player';
}

export function downloadPlayerHTML(html, fileName) {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `player-${fileName.replace('.mp4', '')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
