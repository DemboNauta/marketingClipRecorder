'use strict';

// --- State ---
let videoBlob = null;
let clicks = [];       // [{ t, x, y, vw, vh, zoomLevel, zoomInDuration, holdDuration, zoomOutDuration, enabled }]
let mimeType = 'video/webm';
let ext = 'webm';
let selectedClickIdx = null;
let isPlaying = false;
let rafId = null;

// Default zoom settings (used as initial values per click)
let defaults = {
  zoomLevel: 2.0,
  zoomInDuration: 150,
  holdDuration: 600,
  zoomOutDuration: 250,
};

// --- DOM refs ---
const previewCanvas = document.getElementById('previewCanvas');
const ctx = previewCanvas.getContext('2d');
const sourceVideo = document.getElementById('sourceVideo');
const canvasOverlay = document.getElementById('canvasOverlay');
const loadingMsg = document.getElementById('loadingMsg');
const clickListEl = document.getElementById('clickList');
const clickCountEl = document.getElementById('clickCount');
const sidebarHint = document.getElementById('sidebarHint');
const timelinePlayed = document.getElementById('timelinePlayed');
const clickMarkersEl = document.getElementById('clickMarkers');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const previewBtn = document.getElementById('previewBtn');
const exportBtn = document.getElementById('exportBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const rewindBtn = document.getElementById('rewindBtn');
const exportOverlay = document.getElementById('exportOverlay');
const exportFill = document.getElementById('exportFill');
const exportPercent = document.getElementById('exportPercent');
const timeline = document.getElementById('timeline');

// --- Easing functions ---
const easings = {
  in:     t => t * t * t,
  out:    t => 1 - Math.pow(1 - t, 3),
  linear: t => t,
};

// --- Zoom calculation ---
function getZoomState(currentTimeSec, click) {
  if (!click.enabled) return { scale: 1 };

  const t = currentTimeSec * 1000; // ms
  const { t: clickTime, zoomLevel, zoomInDuration, holdDuration, zoomOutDuration } = click;

  // Zoom-in starts before the click so it peaks exactly AT click time
  const zoomStart = clickTime - zoomInDuration;
  const holdEnd   = clickTime + holdDuration;
  const outEnd    = holdEnd + zoomOutDuration;

  if (t < zoomStart || t > outEnd) return { scale: 1 };

  if (t <= clickTime) {
    const p = (t - zoomStart) / zoomInDuration;
    return { scale: 1 + (zoomLevel - 1) * easings.out(p), cx: click.nx, cy: click.ny };
  }
  if (t <= holdEnd) {
    return { scale: zoomLevel, cx: click.nx, cy: click.ny };
  }
  const p = (t - holdEnd) / zoomOutDuration;
  return { scale: zoomLevel - (zoomLevel - 1) * easings.in(p), cx: click.nx, cy: click.ny };
}

function getActiveZoom(currentTimeSec) {
  // Find the most recent click that is currently active
  let best = null;
  for (const click of clicks) {
    const z = getZoomState(currentTimeSec, click);
    if (z.scale !== 1) {
      if (!best || click.t > best.t) best = { ...z };
    }
  }
  return best;
}

// --- Canvas rendering ---
function renderFrame(timeSec) {
  const W = previewCanvas.width;
  const H = previewCanvas.height;

  ctx.clearRect(0, 0, W, H);

  const zoom = getActiveZoom(timeSec);

  if (zoom && zoom.scale !== 1) {
    const cx = zoom.cx * W;
    const cy = zoom.cy * H;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom.scale, zoom.scale);
    ctx.translate(-cx, -cy);
    ctx.drawImage(sourceVideo, 0, 0, W, H);
    ctx.restore();
  } else {
    ctx.drawImage(sourceVideo, 0, 0, W, H);
  }
}

// --- Video playback loop ---
function startPlaybackLoop() {
  function loop() {
    if (sourceVideo.paused || sourceVideo.ended) {
      isPlaying = false;
      playPauseBtn.textContent = '▶';
      rafId = null;
      if (!sourceVideo.ended) return;
    }
    renderFrame(sourceVideo.currentTime);
    updateTimeDisplay(sourceVideo.currentTime);
    updateTimelineProgress(sourceVideo.currentTime);
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

function stopPlaybackLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

// --- Time helpers ---
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function updateTimeDisplay(t) {
  currentTimeEl.textContent = fmtTime(t);
}

function updateTimelineProgress(t) {
  const pct = sourceVideo.duration ? (t / sourceVideo.duration) * 100 : 0;
  timelinePlayed.style.width = pct + '%';
}

// --- Load data from chrome.storage ---
async function loadData() {
  const data = await chrome.storage.session.get(['mcrEditorClicks', 'mcrEditorMimeType', 'mcrEditorExt']);

  console.log('[MCR editor] loaded from session storage:', data);
  mimeType = data.mcrEditorMimeType || 'video/webm';
  ext = data.mcrEditorExt || 'webm';

  const rawClicks = data.mcrEditorClicks || [];
  console.log('[MCR editor] rawClicks:', rawClicks.length, rawClicks);
  clicks = rawClicks.map(c => ({
    ...c,
    // Normalize coordinates to 0-1 range
    nx: c.x / c.vw,
    ny: c.y / c.vh,
    // Apply defaults
    zoomLevel: defaults.zoomLevel,
    zoomInDuration: defaults.zoomInDuration,
    holdDuration: defaults.holdDuration,
    zoomOutDuration: defaults.zoomOutDuration,
    enabled: true,
  }));

  return loadVideoFromIndexedDB();
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mcr_db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('recordings');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadVideoFromIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readonly');
    const req = tx.objectStore('recordings').get('last');
    req.onsuccess = () => {
      if (req.result) resolve(req.result);
      else reject(new Error('No hay ninguna grabación guardada.'));
    };
    req.onerror = () => reject(req.error);
  });
}

// --- Setup video + canvas ---
function setupVideo(blob) {
  videoBlob = blob;
  const url = URL.createObjectURL(blob);
  sourceVideo.src = url;

  sourceVideo.addEventListener('loadedmetadata', () => {
    // Set canvas to video resolution
    previewCanvas.width = sourceVideo.videoWidth;
    previewCanvas.height = sourceVideo.videoHeight;

    totalTimeEl.textContent = fmtTime(sourceVideo.duration);
    canvasOverlay.classList.add('hidden');

    // Draw first frame
    sourceVideo.currentTime = 0;
    sourceVideo.addEventListener('seeked', () => renderFrame(0), { once: true });

    renderClickList();
    renderClickMarkers();
  });

  sourceVideo.addEventListener('ended', () => {
    isPlaying = false;
    playPauseBtn.textContent = '▶';
    stopPlaybackLoop();
  });
}

// --- Click list UI ---
function renderClickList() {
  clickCountEl.textContent = clicks.length;
  sidebarHint.style.display = clicks.length === 0 ? '' : 'none';
  clickListEl.innerHTML = '';

  clicks.forEach((click, i) => {
    const item = document.createElement('div');
    item.className = 'click-item' + (i === selectedClickIdx ? ' active' : '') + (!click.enabled ? ' disabled' : '');
    item.dataset.idx = i;

    item.innerHTML = `
      <div class="click-item-header">
        <span class="click-label">Click #${i + 1}</span>
        <span class="click-time">${fmtTime(click.t / 1000)}</span>
        <input type="checkbox" class="click-toggle" ${click.enabled ? 'checked' : ''} title="Activar zoom">
      </div>
      <div class="click-settings">
        <div class="click-setting-row">
          <label>Zoom</label>
          <input type="range" class="p-zoom" min="1.5" max="4" step="0.1" value="${click.zoomLevel}">
          <span class="val">${click.zoomLevel.toFixed(1)}×</span>
        </div>
        <div class="click-setting-row">
          <label>Entrada</label>
          <input type="range" class="p-in" min="100" max="800" step="50" value="${click.zoomInDuration}">
          <span class="val">${click.zoomInDuration}ms</span>
        </div>
        <div class="click-setting-row">
          <label>Mantener</label>
          <input type="range" class="p-hold" min="300" max="4000" step="100" value="${click.holdDuration}">
          <span class="val">${click.holdDuration}ms</span>
        </div>
        <div class="click-setting-row">
          <label>Salida</label>
          <input type="range" class="p-out" min="100" max="1000" step="50" value="${click.zoomOutDuration}">
          <span class="val">${click.zoomOutDuration}ms</span>
        </div>
      </div>
    `;

    // Toggle enabled
    item.querySelector('.click-toggle').addEventListener('change', (e) => {
      e.stopPropagation();
      clicks[i].enabled = e.target.checked;
      renderClickList();
      renderClickMarkers();
    });

    // Sliders
    bindSlider(item.querySelector('.p-zoom'),  v => { clicks[i].zoomLevel = parseFloat(v); }, '×', 1);
    bindSlider(item.querySelector('.p-in'),    v => { clicks[i].zoomInDuration = parseInt(v); }, 'ms');
    bindSlider(item.querySelector('.p-hold'),  v => { clicks[i].holdDuration = parseInt(v); }, 'ms');
    bindSlider(item.querySelector('.p-out'),   v => { clicks[i].zoomOutDuration = parseInt(v); }, 'ms');

    // Click to seek to that timestamp
    item.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox' || e.target.type === 'range') return;
      selectedClickIdx = i;
      seekTo(clicks[i].t / 1000);
      renderClickList();
      renderClickMarkers();
    });

    clickListEl.appendChild(item);
  });
}

function bindSlider(input, setter, unit, decimals = 0) {
  input.addEventListener('input', () => {
    setter(input.value);
    const span = input.nextElementSibling;
    span.textContent = decimals > 0
      ? parseFloat(input.value).toFixed(decimals) + unit
      : input.value + unit;
    if (!sourceVideo.paused) return;
    renderFrame(sourceVideo.currentTime);
  });
}

// --- Click markers on timeline ---
function renderClickMarkers() {
  clickMarkersEl.innerHTML = '';
  if (!sourceVideo.duration) return;

  clicks.forEach((click, i) => {
    const pct = (click.t / 1000 / sourceVideo.duration) * 100;
    const marker = document.createElement('div');
    marker.className = 'click-marker'
      + (i === selectedClickIdx ? ' active' : '')
      + (!click.enabled ? ' disabled' : '');
    marker.style.left = pct + '%';
    marker.title = `Click #${i + 1} — ${fmtTime(click.t / 1000)}`;

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedClickIdx = i;
      seekTo(click.t / 1000);
      renderClickList();
      renderClickMarkers();
    });

    clickMarkersEl.appendChild(marker);
  });
}

// --- Seek ---
function seekTo(timeSec) {
  stopPlaybackLoop();
  isPlaying = false;
  playPauseBtn.textContent = '▶';
  sourceVideo.currentTime = Math.max(0, Math.min(timeSec, sourceVideo.duration || 0));
  sourceVideo.addEventListener('seeked', () => {
    renderFrame(sourceVideo.currentTime);
    updateTimeDisplay(sourceVideo.currentTime);
    updateTimelineProgress(sourceVideo.currentTime);
  }, { once: true });
}

// --- Playback controls ---
playPauseBtn.addEventListener('click', () => {
  if (sourceVideo.paused) {
    sourceVideo.play();
    isPlaying = true;
    playPauseBtn.textContent = '⏸';
    startPlaybackLoop();
  } else {
    sourceVideo.pause();
    isPlaying = false;
    playPauseBtn.textContent = '▶';
    stopPlaybackLoop();
    renderFrame(sourceVideo.currentTime);
  }
});

rewindBtn.addEventListener('click', () => seekTo(0));

timeline.addEventListener('click', (e) => {
  const rect = timeline.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  seekTo(pct * (sourceVideo.duration || 0));
});

// --- Preview button ---
previewBtn.addEventListener('click', () => {
  seekTo(0);
  setTimeout(() => {
    sourceVideo.play();
    isPlaying = true;
    playPauseBtn.textContent = '⏸';
    startPlaybackLoop();
  }, 100);
});

// --- Global defaults ---
function setupDefaultSliders() {
  const map = [
    ['defaultZoom', 'defaultZoomVal', 'zoomLevel', '×', 1],
    ['defaultZoomIn', 'defaultZoomInVal', 'zoomInDuration', 'ms', 0],
    ['defaultHold', 'defaultHoldVal', 'holdDuration', 'ms', 0],
    ['defaultZoomOut', 'defaultZoomOutVal', 'zoomOutDuration', 'ms', 0],
  ];
  map.forEach(([id, valId, key, unit, dec]) => {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(valId);
    slider.addEventListener('input', () => {
      defaults[key] = parseFloat(slider.value);
      valEl.textContent = dec > 0
        ? parseFloat(slider.value).toFixed(dec) + unit
        : slider.value + unit;
    });
  });

  document.getElementById('applyDefaultsBtn').addEventListener('click', () => {
    clicks.forEach(c => Object.assign(c, {
      zoomLevel: defaults.zoomLevel,
      zoomInDuration: defaults.zoomInDuration,
      holdDuration: defaults.holdDuration,
      zoomOutDuration: defaults.zoomOutDuration,
    }));
    renderClickList();
    if (sourceVideo.paused) renderFrame(sourceVideo.currentTime);
  });
}

// --- Export ---
exportBtn.addEventListener('click', exportVideo);

// --- FFmpeg zoom filter builder ---
function buildZoomFilter(enabledClicks, W, H) {
  let zExpr = '1';
  let xExpr = '0';
  let yExpr = '0';

  for (const c of [...enabledClicks].reverse()) {
    const ts     = c.t / 1000;
    const zIn    = c.zoomInDuration / 1000;
    const hold   = c.holdDuration / 1000;
    const zOut   = c.zoomOutDuration / 1000;
    const tStart = Math.max(0, ts - zIn);
    const tEnd   = ts + hold + zOut;
    const Z      = c.zoomLevel;

    // Linear easing (smooth enough for marketing clips)
    const inPhase  = `(1+(${Z}-1)*((t-${tStart})/${zIn}))`;
    const outPhase = `(${Z}-(${Z}-1)*((t-${ts + hold})/${zOut}))`;

    zExpr = `if(between(t\\,${tStart}\\,${ts})\\,${inPhase}\\,if(between(t\\,${ts}\\,${ts + hold})\\,${Z}\\,if(between(t\\,${ts + hold}\\,${tEnd})\\,${outPhase}\\,${zExpr})))`;
    xExpr = `if(between(t\\,${tStart}\\,${tEnd})\\,max(0\\,min(iw-iw/zoom\\,${c.nx}*iw-iw/zoom/2))\\,${xExpr})`;
    yExpr = `if(between(t\\,${tStart}\\,${tEnd})\\,max(0\\,min(ih-ih/zoom\\,${c.ny}*ih-ih/zoom/2))\\,${yExpr})`;
  }

  return `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':fps=30:d=1:s=${W}x${H}`;
}

// --- FFmpeg export ---
async function exportVideo() {
  if (!videoBlob) return;

  exportBtn.disabled = true;
  previewBtn.disabled = true;
  exportOverlay.style.display = 'flex';
  exportFill.style.width = '0%';
  exportPercent.textContent = '0%';

  try {
    const { createFFmpeg, fetchFile } = window.FFmpeg;
    const ffmpeg = createFFmpeg({
      corePath: chrome.runtime.getURL('lib/ffmpeg-core.js'),
      log: false,
    });

    ffmpeg.setProgress(({ ratio }) => {
      const pct = Math.min(99, Math.round(ratio * 100));
      exportFill.style.width = pct + '%';
      exportPercent.textContent = pct + '%';
    });

    await ffmpeg.load();

    const inputExt  = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const inputName = `input.${inputExt}`;
    ffmpeg.FS('writeFile', inputName, await fetchFile(videoBlob));

    const W = sourceVideo.videoWidth;
    const H = sourceVideo.videoHeight;
    const enabledClicks = clicks.filter(c => c.enabled);

    const args = ['-i', inputName];
    if (enabledClicks.length > 0) {
      args.push('-vf', buildZoomFilter(enabledClicks, W, H));
    }
    args.push(
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      'output.mp4'
    );

    await ffmpeg.run(...args);

    const data = ffmpeg.FS('readFile', 'output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `clip-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    exportFill.style.width = '100%';
    exportPercent.textContent = '100%';
    setTimeout(() => {
      exportOverlay.style.display = 'none';
      exportBtn.disabled = false;
      previewBtn.disabled = false;
    }, 600);

  } catch (err) {
    console.error('[MCR export] Error:', err);
    exportOverlay.style.display = 'none';
    exportBtn.disabled = false;
    previewBtn.disabled = false;
    alert('Error al exportar: ' + err.message);
  }
}

// --- Init ---
setupDefaultSliders();

loadData()
  .then(blob => {
    setupVideo(blob);
  })
  .catch(err => {
    loadingMsg.textContent = 'Error: ' + err.message;
  });
