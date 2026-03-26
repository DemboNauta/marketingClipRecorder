'use strict';

// --- State ---
let videoBlob = null;
let clicks = [];       // [{ t, x, y, vw, vh, zoomLevel, zoomInDuration, holdDuration, zoomOutDuration, enabled }]
let mimeType = 'video/webm';
let ext = 'webm';
let selectedClickIdx = null;
let isPlaying = false;
let rafId = null;
let isDragging = false;
let dragInfo = null; // { idx, type, initialValue, initialT }

// Default zoom settings (used as initial values per click)
let defaults = {
  zoomLevel: 2.0,
  zoomInDuration: 150,
  holdDuration: 600,
  zoomOutDuration: 250,
  zoomOffset: 0,
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
  const { t: clickTime, zoomLevel, zoomInDuration, holdDuration, zoomOutDuration, zoomOffset = 0 } = click;

  // Zoom peaks at clickTime + zoomOffset
  const zoomPeak  = clickTime + zoomOffset;
  const zoomStart = zoomPeak - zoomInDuration;
  const holdEnd   = zoomPeak + holdDuration;
  const outEnd    = holdEnd + zoomOutDuration;

  if (t < zoomStart || t > outEnd) return { scale: 1 };

  let currentScale = 1;
  let progress = 0; // 0 to 1 during zoom in, stays 1 during hold, 1 to 0 during zoom out

  if (t <= zoomPeak) {
    progress = (t - zoomStart) / zoomInDuration;
    currentScale = 1 + (zoomLevel - 1) * easings.out(progress);
  } else if (t <= holdEnd) {
    progress = 1;
    currentScale = zoomLevel;
  } else {
    const p = (t - holdEnd) / zoomOutDuration;
    progress = 1 - easings.in(p);
    currentScale = 1 + (zoomLevel - 1) * progress;
  }

  return { 
    scale: currentScale, 
    cx: click.nx, 
    cy: click.ny, 
    progress: progress // Use progress to push the "center" towards the click
  };
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
    const s = zoom.scale;
    const nx = zoom.cx;
    const ny = zoom.cy;
    
    // Position of the click in video coordinates
    const vx = nx * W;
    const vy = ny * H;

    // We want to transform the video such that:
    // 1. It is scaled by 's'
    // 2. The click point (vx, vy) is as close as possible to the center of the canvas (W/2, H/2)
    // 3. The video still covers the whole canvas [0,W]x[0,H]

    // Width and height of the scaled video
    const sw = W * s;
    const sh = H * s;

    // Ideal top-left position (tx, ty) to center the click (vx, vy) at (W/2, H/2)
    // tx + vx * s = W/2  =>  tx = W/2 - vx * s
    let tx = W/2 - vx * s;
    let ty = H/2 - vy * s;

    // Clamp top-left position so we don't show area outside the video
    // tx must be in [W - sw, 0]
    tx = Math.max(W - sw, Math.min(0, tx));
    ty = Math.max(H - sh, Math.min(0, ty));

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(s, s);
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

  mimeType = data.mcrEditorMimeType || 'video/webm';
  ext = data.mcrEditorExt || 'webm';

  const rawClicks = data.mcrEditorClicks || [];
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
    zoomOffset: defaults.zoomOffset,
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
      else reject(new Error('No recording found.'));
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
        <input type="checkbox" class="click-toggle" ${click.enabled ? 'checked' : ''} title="Enable zoom">
      </div>
      <div class="click-settings">
        <div class="click-setting-row">
          <label>Zoom</label>
          <input type="range" class="p-zoom" min="1.5" max="4" step="0.1" value="${click.zoomLevel}">
          <span class="val">${click.zoomLevel.toFixed(1)}×</span>
        </div>
        <div class="click-setting-row">
          <label>Ease in</label>
          <input type="range" class="p-in" min="100" max="5000" step="50" value="${Math.round(click.zoomInDuration)}">
          <span class="val">${Math.round(click.zoomInDuration)}ms</span>
        </div>
        <div class="click-setting-row">
          <label>Hold</label>
          <input type="range" class="p-hold" min="300" max="4000" step="100" value="${click.holdDuration}">
          <span class="val">${click.holdDuration}ms</span>
        </div>
        <div class="click-setting-row">
          <label>Ease out</label>
          <input type="range" class="p-out" min="100" max="5000" step="50" value="${Math.round(click.zoomOutDuration)}">
          <span class="val">${Math.round(click.zoomOutDuration)}ms</span>
        </div>
        <div class="click-setting-row">
          <label>Offset</label>
          <input type="range" class="p-offset" min="-500" max="500" step="10" value="${Math.round(click.zoomOffset || 0)}">
          <span class="val">${Math.round(click.zoomOffset || 0)}ms</span>
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
    bindSlider(item.querySelector('.p-in'),    v => { clicks[i].zoomInDuration = Math.round(v); }, 'ms');
    bindSlider(item.querySelector('.p-hold'),  v => { clicks[i].holdDuration = Math.round(v); }, 'ms');
    bindSlider(item.querySelector('.p-out'),   v => { clicks[i].zoomOutDuration = Math.round(v); }, 'ms');
    bindSlider(item.querySelector('.p-offset'),v => { clicks[i].zoomOffset = Math.round(v); }, 'ms');

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

  const totalTime = sourceVideo.duration * 1000;

  clicks.forEach((click, i) => {
    const isSelected = i === selectedClickIdx;
    
    // Timing calculations
    const zoomPeak  = click.t + (click.zoomOffset || 0);
    const zoomStart = zoomPeak - click.zoomInDuration;
    const zoomEnd   = zoomPeak + click.holdDuration + click.zoomOutDuration;

    // Percentages
    const startPct = (zoomStart / totalTime) * 100;
    const endPct   = (zoomEnd / totalTime) * 100;
    const clickPct = (click.t / totalTime) * 100;

    // 1. Zoom range background
    const range = document.createElement('div');
    range.className = 'click-range' + (isSelected ? ' active' : '') + (!click.enabled ? ' disabled' : '');
    range.style.left = startPct + '%';
    range.style.width = Math.max(0.5, endPct - startPct) + '%';
    range.style.cursor = 'grab';
    range.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectedClickIdx = i;
      startDrag(e, i, 'range');
    });
    range.addEventListener('click', (e) => e.stopPropagation());
    clickMarkersEl.appendChild(range);

    // 2. Start/End dots (2 puntitos)
    if (click.enabled) {
      const dotStart = document.createElement('div');
      dotStart.className = 'click-dot' + (isSelected ? ' active' : '');
      dotStart.style.left = startPct + '%';
      dotStart.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectedClickIdx = i;
        startDrag(e, i, 'start');
      });
      clickMarkersEl.appendChild(dotStart);

      const dotEnd = document.createElement('div');
      dotEnd.className = 'click-dot' + (isSelected ? ' active' : '');
      dotEnd.style.left = endPct + '%';
      dotEnd.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectedClickIdx = i;
        startDrag(e, i, 'end');
      });
      clickMarkersEl.appendChild(dotEnd);
    }

    // 3. Click marker (The peak/event)
    const marker = document.createElement('div');
    marker.className = 'click-marker'
      + (isSelected ? ' active' : '')
      + (!click.enabled ? ' disabled' : '');
    marker.style.left = clickPct + '%';
    marker.title = `Click #${i + 1} — ${fmtTime(click.t / 1000)}`;

    marker.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectedClickIdx = i;
      startDrag(e, i, 'click');
    });

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isDragging) {
        selectedClickIdx = i;
        seekTo(click.t / 1000);
        renderClickList();
        renderClickMarkers();
      }
    });

    clickMarkersEl.appendChild(marker);
  });
}

// --- DRAG logic ---
function startDrag(e, idx, type) {
  isDragging = true;
  const click = clicks[idx];
  const clickTime = click.t;
  const zoomPeak = clickTime + (click.zoomOffset || 0);

  let initialVal = 0;
  if (type === 'click') initialVal = clickTime;
  else if (type === 'start') initialVal = click.zoomInDuration;
  else if (type === 'end') initialVal = click.zoomOutDuration;
  else if (type === 'range') initialVal = click.zoomOffset || 0;

  dragInfo = {
    idx,
    type,
    initialVal,
    initialX: e.clientX,
    zoomPeak, // Pre-calculated peak during start for start/end drags
    holdEnd: zoomPeak + click.holdDuration, // For end dot drag
  };

  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragStop);
  document.body.style.cursor = 'ew-resize';
  renderClickList();
  renderClickMarkers();
}

function onDragMove(e) {
  if (!isDragging || !dragInfo) return;
  const { idx, type, initialVal, initialX, zoomPeak, holdEnd } = dragInfo;
  const click = clicks[idx];
  const totalDuration = sourceVideo.duration * 1000;
  const timelineRect = timeline.getBoundingClientRect();

  const dx = e.clientX - initialX;
  const dt = (dx / timelineRect.width) * totalDuration;

  if (type === 'click') {
    click.t = Math.round(Math.max(0, Math.min(totalDuration, initialVal + dt)));
  } else if (type === 'start') {
    const newT = (zoomPeak - initialVal) + dt;
    click.zoomInDuration = Math.round(Math.max(50, zoomPeak - newT));
  } else if (type === 'end') {
    const newT = (holdEnd + initialVal) + dt;
    click.zoomOutDuration = Math.round(Math.max(50, newT - holdEnd));
  } else if (type === 'range') {
    click.zoomOffset = Math.round(initialVal + dt);
  }

  // Live preview
  if (sourceVideo.paused) {
    if (type === 'click') sourceVideo.currentTime = click.t / 1000;
    else if (type === 'range' || type === 'start') sourceVideo.currentTime = (click.t + click.zoomOffset) / 1000;
    else {
      // For end drag, maybe show the end of the zoom out
      sourceVideo.currentTime = (click.t + click.zoomOffset + click.holdDuration + click.zoomOutDuration) / 1000;
    }
    renderFrame(sourceVideo.currentTime);
  }

  renderClickList();
  renderClickMarkers();
}

function onDragStop() {
  isDragging = false;
  dragInfo = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragStop);
  document.body.style.cursor = '';
  renderClickList();
  renderClickMarkers();
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
    ['defaultOffset', 'defaultOffsetVal', 'zoomOffset', 'ms', 0],
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
      zoomOffset: defaults.zoomOffset,
    }));
    renderClickList();
    if (sourceVideo.paused) renderFrame(sourceVideo.currentTime);
  });
}

// --- Export ---
exportBtn.addEventListener('click', exportVideo);

// --- Export (MediaRecorder) ---
async function exportVideo() {
  if (!videoBlob) return;

  exportBtn.disabled = true;
  previewBtn.disabled = true;
  exportOverlay.style.display = 'flex';
  exportFill.style.width = '0%';
  exportPercent.textContent = 'Recording (do not switch tabs)...';

  try {
    // Positioning at the start
    seekTo(0);
    // Give enough time to ensure UI is ready and the frame is painted
    await new Promise(r => setTimeout(r, 600));

    // Capture the stream at 60 FPS for buttery smooth Marketing videos
    const stream = previewCanvas.captureStream(60);
    
    // WebM with VP9 at very high bitrate provides practically loss-less recording on Modern Chrome
    const options = { mimeType: 'video/webm; codecs=vp9', videoBitsPerSecond: 12000000 };
    let mediaRecorder;
    try {
        mediaRecorder = new MediaRecorder(stream, options);
    } catch(e) {
        console.warn('VP9 not supported by MediaRecorder, falling back to default.', e);
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 12000000 });
    }

    const recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clip-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      exportOverlay.style.display = 'none';
      exportBtn.disabled = false;
      previewBtn.disabled = false;
      
      // Keep UI clean
      stopPlaybackLoop();
      playPauseBtn.textContent = '▶';
    };

    // Keep chunks small to handle memory easily
    mediaRecorder.start(100);

    // Run the video in real-time
    if (sourceVideo.paused) {
      sourceVideo.play();
      isPlaying = true;
      playPauseBtn.textContent = '⏸';
      startPlaybackLoop();
    }

    // Progress bar monitor
    const duration = sourceVideo.duration || 1;
    const progressInterval = setInterval(() => {
      const pct = Math.min(100, Math.round((sourceVideo.currentTime / duration) * 100));
      exportFill.style.width = pct + '%';
      
      // Stop the recording when the video naturally finishes
      if (sourceVideo.ended || sourceVideo.currentTime >= duration) {
        clearInterval(progressInterval);
        exportFill.style.width = '100%';
        exportPercent.textContent = 'Processing file...';
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      } else {
        exportPercent.textContent = pct + '%';
      }
    }, 200);

  } catch (err) {
    console.error('[MCR export] Error:', err);
    exportOverlay.style.display = 'none';
    exportBtn.disabled = false;
    previewBtn.disabled = false;
    alert('Export error: ' + err.message);
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
