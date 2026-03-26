'use strict';

const MSG = {
  START_RECORDING:   'START_RECORDING',
  STOP_RECORDING:    'STOP_RECORDING',
  INIT_RECORDING:    'INIT_RECORDING',
  RECORDING_STARTED: 'RECORDING_STARTED',
  RECORDING_STOPPED: 'RECORDING_STOPPED',
  RECORDING_READY:   'RECORDING_READY',
  CONFIG_UPDATED:    'CONFIG_UPDATED',
  GET_STATE:         'GET_STATE',
  GET_CLICKS:        'GET_CLICKS',
};

// --- State (persisted to session storage to survive SW suspension) ---
let recordingTabId = null;
let isRecording = false;
let recordingStartTime = null;

async function loadState() {
  const data = await chrome.storage.session.get(['recordingTabId', 'isRecording', 'recordingStartTime']);
  recordingTabId = data.recordingTabId || null;
  isRecording = data.isRecording || false;
  recordingStartTime = data.recordingStartTime || null;
}

async function saveState() {
  await chrome.storage.session.set({ recordingTabId, isRecording, recordingStartTime });
}

async function clearState() {
  recordingTabId = null;
  isRecording = false;
  recordingStartTime = null;
  await chrome.storage.session.remove(['recordingTabId', 'isRecording', 'recordingStartTime']);
}

// --- Offscreen document ---

async function ensureOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Recording tab audio and video via tabCapture stream',
    });
  } catch (e) {
    if (!e.message || !e.message.includes('single')) throw e;
  }
}

async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) { /* already closed */ }
}

// --- Helpers ---

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch (e) {
    // Content script not running — inject it now
await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    console.warn('[MCR] Could not reach content script in tab', tabId, e.message);
    return null;
  }
}

function sendToOffscreen(message) {
  return chrome.runtime.sendMessage(message);
}

// --- Start recording ---

async function startRecording(config, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) { sendResponse({ error: 'No active tab found.' }); return; }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      sendResponse({ error: 'Cannot record Chrome system pages.' }); return;
    }

    await ensureOffscreenDocument();
    await ensureContentScript(tab.id);

    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    recordingTabId = tab.id;
    isRecording = true;
    recordingStartTime = Date.now();
    await saveState();

    await sendToOffscreen({ type: MSG.INIT_RECORDING, streamId, config });

    await sendToContentScript(tab.id, {
      type: MSG.RECORDING_STARTED,
      config,
      startTime: recordingStartTime,
    });

    sendResponse({ ok: true });
  } catch (err) {
    console.error('[MCR] startRecording error:', err);
    await closeOffscreenDocument();
    await clearState();
    sendResponse({ error: err.message });
  }
}

// --- Stop recording ---

async function stopRecording(sendResponse) {
  try {
    const tabId = recordingTabId;

    await sendToOffscreen({ type: MSG.STOP_RECORDING });
    await sendToContentScript(tabId, { type: MSG.RECORDING_STOPPED });

    // Preserve tabId separately so RECORDING_READY can still fetch clicks
    await chrome.storage.session.set({ mcrPendingTabId: tabId });
    await clearState();

    if (sendResponse) sendResponse({ ok: true });
  } catch (err) {
    console.error('[MCR] stopRecording error:', err);
    await clearState();
    if (sendResponse) sendResponse({ error: err.message });
  }
}

// --- Open editor after recording is ready ---

async function openEditor(mimeType, ext, tabId) {
  // Collect click log from the content script
  let clicks = [];
  if (tabId) {
    const resp = await sendToContentScript(tabId, { type: MSG.GET_CLICKS });
    if (resp && resp.clicks) clicks = resp.clicks;
  } else {
    console.warn('[MCR bg] openEditor: tabId is null, cannot fetch clicks');
  }

  // Persist click data and metadata for the editor to read
  await chrome.storage.session.set({
    mcrEditorClicks: clicks,
    mcrEditorMimeType: mimeType,
    mcrEditorExt: ext,
  });

  // Open the editor in a new tab
  await chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });

  // Close offscreen doc after editor is opened
  setTimeout(() => closeOffscreenDocument(), 1000);
}

// --- Message listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  if (type === MSG.GET_STATE) {
    loadState().then(() => sendResponse({ isRecording, startTime: recordingStartTime }));
    return true;
  }

  if (type === MSG.START_RECORDING) {
    loadState().then(() => {
      if (isRecording) { sendResponse({ error: 'A recording is already in progress.' }); return; }
      startRecording(message.config, sendResponse);
    });
    return true;
  }

  if (type === MSG.STOP_RECORDING) {
    loadState().then(() => stopRecording(sendResponse));
    return true;
  }

  if (type === MSG.RECORDING_READY) {
    // Offscreen finished — collect clicks and open editor
    chrome.storage.session.get('mcrPendingTabId').then(async (data) => {
      const tabId = data.mcrPendingTabId || null;
      await openEditor(message.mimeType, message.ext, tabId);
      await chrome.storage.session.remove('mcrPendingTabId');
    });
    return false;
  }

  if (type === MSG.CONFIG_UPDATED) {
    loadState().then(() => {
      if (isRecording && recordingTabId) {
        sendToContentScript(recordingTabId, { type: MSG.CONFIG_UPDATED, config: message.config });
      }
    });
    return false;
  }
});
