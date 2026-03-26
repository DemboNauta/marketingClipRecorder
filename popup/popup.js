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
const clickIndicatorCheckbox = document.getElementById('clickIndicator');

// --- State ---
let isRecording = false;
let timerInterval = null;
let startTime = null;

// --- Init ---
async function init() {
  // Configuración
  const stored = await chrome.storage.sync.get('mcrConfig');
  if (stored.mcrConfig && typeof stored.mcrConfig.clickIndicator !== 'undefined') {
    clickIndicatorCheckbox.checked = stored.mcrConfig.clickIndicator;
  } else {
    clickIndicatorCheckbox.checked = DEFAULT_CONFIG.clickIndicator;
  }

  // Check recording state from background
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp && resp.isRecording) {
      setRecordingUI(true, resp.startTime);
    }
  });
}

// Guarda la configuración dinámica si cambian el checkbox
clickIndicatorCheckbox.addEventListener('change', async () => {
  const config = Object.assign({}, DEFAULT_CONFIG, {
    clickIndicator: clickIndicatorCheckbox.checked
  });
  await chrome.storage.sync.set({ mcrConfig: config });
  
  // Update in real-time if already recording
  if (isRecording) {
    chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', config });
  }
});

// --- Recording UI state ---
function setRecordingUI(recording, recordStartTime = null) {
  isRecording = recording;

  if (recording) {
    recordBtn.classList.add('stop');
    btnIcon.textContent = '⏹';
    btnLabel.textContent = 'Stop';
    statusDot.classList.add('recording');
    timerEl.classList.add('recording');
    startTime = recordStartTime || Date.now();
    timerInterval = setInterval(updateTimer, 500);
    updateTimer();
    setStatus('Recording...', '');
  } else {
    recordBtn.classList.remove('stop');
    btnIcon.textContent = '⏺';
    btnLabel.textContent = 'Record';
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
        setStatus('Error stopping: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      setRecordingUI(false);
      setStatus('Video downloaded.', 'success');
    });
  } else {
    recordBtn.disabled = true;
    setStatus('Starting...', '');

    const configToStart = Object.assign({}, DEFAULT_CONFIG, {
      clickIndicator: clickIndicatorCheckbox.checked
    });
    // Forzamos guardar por si acaso
    await chrome.storage.sync.set({ mcrConfig: configToStart });

    chrome.runtime.sendMessage({ type: 'START_RECORDING', config: configToStart }, (resp) => {
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

init();
