'use strict';

const DEFAULT_CONFIG = {
  zoomLevel: 2.0,
  zoomInDuration: 150,
  holdDuration: 600,
  zoomOutDuration: 250,
  easingIn: 'cubic-bezier(0.25,0.46,0.45,0.94)',
  easingOut: 'cubic-bezier(0.55,0,1,0.45)',
  zoomTriggerKey: 'none',
  audioCaptureEnabled: true,
  clickIndicator: true,
};

// --- DOM refs ---
const recordBtn = document.getElementById('recordBtn');
const btnLabel = document.getElementById('btnLabel');
const btnIcon = document.getElementById('btnIcon');
const statusDot = document.getElementById('statusDot');
const timerEl = document.getElementById('timer');
const statusMsg = document.getElementById('statusMsg');

const sliders = {
  zoomLevel: { el: document.getElementById('zoomLevel'), val: document.getElementById('zoomLevelVal'), fmt: v => `${parseFloat(v).toFixed(1)}×` },
  zoomInDuration: { el: document.getElementById('zoomInDuration'), val: document.getElementById('zoomInDurationVal'), fmt: v => `${v}ms` },
  holdDuration: { el: document.getElementById('holdDuration'), val: document.getElementById('holdDurationVal'), fmt: v => `${v}ms` },
  zoomOutDuration: { el: document.getElementById('zoomOutDuration'), val: document.getElementById('zoomOutDurationVal'), fmt: v => `${v}ms` },
};

const selects = {
  easingIn: document.getElementById('easingIn'),
  easingOut: document.getElementById('easingOut'),
  zoomTriggerKey: document.getElementById('zoomTriggerKey'),
};

const checkboxes = {
  audioCaptureEnabled: document.getElementById('audioCaptureEnabled'),
  clickIndicator: document.getElementById('clickIndicator'),
};

// --- State ---
let isRecording = false;
let timerInterval = null;
let startTime = null;

// --- Init ---
async function init() {
  const stored = await chrome.storage.sync.get('mcrConfig');
  const config = Object.assign({}, DEFAULT_CONFIG, stored.mcrConfig || {});
  applyConfigToUI(config);

  // Check recording state from background
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp && resp.isRecording) {
      setRecordingUI(true, resp.startTime);
    }
  });
}

function applyConfigToUI(config) {
  for (const [key, { el, val, fmt }] of Object.entries(sliders)) {
    el.value = config[key];
    val.textContent = fmt(config[key]);
  }
  for (const [key, el] of Object.entries(selects)) {
    el.value = config[key];
  }
  for (const [key, el] of Object.entries(checkboxes)) {
    el.checked = config[key];
  }
}

function getConfigFromUI() {
  const config = {};
  for (const [key, { el }] of Object.entries(sliders)) {
    config[key] = parseFloat(el.value);
  }
  for (const [key, el] of Object.entries(selects)) {
    config[key] = el.value;
  }
  for (const [key, el] of Object.entries(checkboxes)) {
    config[key] = el.checked;
  }
  return config;
}

// --- Recording UI state ---
function setRecordingUI(recording, recordStartTime = null) {
  isRecording = recording;

  if (recording) {
    recordBtn.classList.add('stop');
    btnIcon.textContent = '⏹';
    btnLabel.textContent = 'Detener';
    statusDot.classList.add('recording');
    timerEl.classList.add('recording');
    startTime = recordStartTime || Date.now();
    timerInterval = setInterval(updateTimer, 500);
    updateTimer();
    setStatus('Grabando...', '');
  } else {
    recordBtn.classList.remove('stop');
    btnIcon.textContent = '⏺';
    btnLabel.textContent = 'Grabar';
    statusDot.classList.remove('recording');
    timerEl.classList.remove('recording');
    clearInterval(timerInterval);
    timerEl.textContent = '00:00';
    startTime = null;
  }
}

function updateTimer() {
  if (!startTime) return;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
}

function setStatus(msg, type = '') {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg' + (type ? ` ${type}` : '');
}

// --- Button click ---
recordBtn.addEventListener('click', async () => {
  if (isRecording) {
    recordBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (resp) => {
      recordBtn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus('Error al detener: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      setRecordingUI(false);
      setStatus('Video descargado.', 'success');
    });
  } else {
    const config = getConfigFromUI();
    await chrome.storage.sync.set({ mcrConfig: config });

    recordBtn.disabled = true;
    setStatus('Iniciando...', '');

    chrome.runtime.sendMessage({ type: 'START_RECORDING', config }, (resp) => {
      recordBtn.disabled = false;
      if (chrome.runtime.lastError || (resp && resp.error)) {
        const err = (resp && resp.error) || chrome.runtime.lastError.message;
        setStatus('Error: ' + err, 'error');
        return;
      }
      setRecordingUI(true);
    });
  }
});

// --- Live config update during recording ---
let configUpdateTimeout = null;
function onConfigChange() {
  const config = getConfigFromUI();

  // Update display values
  for (const [key, { el, val, fmt }] of Object.entries(sliders)) {
    val.textContent = fmt(el.value);
  }

  // Debounce save + live update
  clearTimeout(configUpdateTimeout);
  configUpdateTimeout = setTimeout(async () => {
    await chrome.storage.sync.set({ mcrConfig: config });
    if (isRecording) {
      chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', config });
    }
  }, 200);
}

for (const { el } of Object.values(sliders)) {
  el.addEventListener('input', onConfigChange);
}
for (const el of Object.values(selects)) {
  el.addEventListener('change', onConfigChange);
}
for (const el of Object.values(checkboxes)) {
  el.addEventListener('change', onConfigChange);
}

init();
