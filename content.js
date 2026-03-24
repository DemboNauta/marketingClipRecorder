'use strict';

const MSG = {
  RECORDING_STARTED: 'RECORDING_STARTED',
  RECORDING_STOPPED: 'RECORDING_STOPPED',
  CONFIG_UPDATED:    'CONFIG_UPDATED',
  GET_CLICKS:        'GET_CLICKS',
};

const STYLE_ID   = 'mcr-styles';
const RIPPLE_CLS = 'mcr-ripple';

let isActive = false;
let config = null;
let recordingStartTime = null;
let clickLog = [];

// --- Activate / deactivate ---

function activate(cfg, startTime) {
  if (isActive) return;
  config = cfg;
  recordingStartTime = startTime;
  clickLog = [];
  isActive = true;
  injectStyles();
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  
  console.log('[MCR content] activated, startTime:', startTime, 'triggerKey:', cfg.zoomTriggerKey);
}

function deactivate() {
  if (!isActive) return;
  isActive = false;
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onKeyDown, true);
  
  removeStyles();
  document.querySelectorAll(`.${RIPPLE_CLS}`).forEach(el => el.remove());
}

function onKeyDown(e) {
  if (isActive && e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  }
}

// --- Styles (ripple + overlay) ---

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${RIPPLE_CLS} {
      position: fixed;
      pointer-events: none;
      border-radius: 50%;
      background: rgba(220, 60, 60, 0.3);
      border: 2px solid rgba(220, 60, 60, 0.85);
      transform: translate(-50%, -50%) scale(0);
      animation: mcr-ripple 0.65s cubic-bezier(0.4, 0, 0.6, 1) forwards;
      z-index: 2147483647;
    }
    @keyframes mcr-ripple {
      0%   { transform: translate(-50%, -50%) scale(0);   opacity: 1; }
      60%  { transform: translate(-50%, -50%) scale(1);   opacity: 0.6; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function removeStyles() {
  document.getElementById(STYLE_ID)?.remove();
}

// --- Click handler ---

function onDocClick(e) {
  if (!isActive) return;

  // En modo editor siempre se registran todos los clicks —
  // el filtro por tecla solo aplica si el zoom es en vivo (sin editor)
  const t = Date.now() - recordingStartTime;
  clickLog.push({
    t,
    x: e.clientX,
    y: e.clientY,
    vw: window.innerWidth,
    vh: window.innerHeight,
  });
  console.log('[MCR content] click tracked:', { t, x: e.clientX, y: e.clientY }, 'total:', clickLog.length);

  spawnRipple(e.clientX, e.clientY);
}

// --- Ripple visual ---

function spawnRipple(x, y) {
  if (!config.clickIndicator) return;
  const size = Math.min(window.innerWidth, window.innerHeight) * 0.08;
  const el = document.createElement('div');
  el.className = RIPPLE_CLS;
  el.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;`;
  document.documentElement.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// --- Messages ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === MSG.RECORDING_STARTED) {
    activate(message.config, message.startTime);
  } else if (message.type === MSG.RECORDING_STOPPED) {
    deactivate();
  } else if (message.type === MSG.CONFIG_UPDATED) {
    config = Object.assign({}, config, message.config);
  } else if (message.type === MSG.GET_CLICKS) {
    console.log('[MCR content] GET_CLICKS requested, sending', clickLog.length, 'clicks');
    sendResponse({ clicks: clickLog });
    return true;
  }
});
