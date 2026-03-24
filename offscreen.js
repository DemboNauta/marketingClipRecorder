'use strict';

const MSG = {
  INIT_RECORDING:  'INIT_RECORDING',
  STOP_RECORDING:  'STOP_RECORDING',
  RECORDING_READY: 'RECORDING_READY',
};

let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let requestDataInterval = null;
let currentMimeType = 'video/webm';

const MIME_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function getSupportedMimeType() {
  return MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

function getExtension(mimeType) {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

// --- IndexedDB ---

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mcr_db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('recordings');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToIndexedDB(blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put(blob, 'last');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// --- Recording ---

async function startRecording(streamId, config) {
  try {
    const constraints = {
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    };
    if (config.audioCaptureEnabled) {
      constraints.audio = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } };
    }

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentMimeType = getSupportedMimeType();
    recordedChunks = [];

    mediaRecorder = new MediaRecorder(stream, { mimeType: currentMimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: currentMimeType });
      await saveToIndexedDB(blob);
      chrome.runtime.sendMessage({
        type: MSG.RECORDING_READY,
        mimeType: currentMimeType,
        ext: getExtension(currentMimeType),
      });
      cleanup();
    };

    mediaRecorder.onerror = (e) => {
      console.error('[MCR Offscreen] MediaRecorder error:', e);
      cleanup();
    };

    mediaRecorder.start();
    requestDataInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.requestData();
    }, 5000);

  } catch (err) {
    console.error('[MCR Offscreen] startRecording failed:', err);
    cleanup();
  }
}

function stopRecording() {
  clearInterval(requestDataInterval);
  requestDataInterval = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    cleanup();
  }
}

function cleanup() {
  clearInterval(requestDataInterval);
  requestDataInterval = null;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  mediaRecorder = null;
  recordedChunks = [];
}

// --- Messages ---

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.INIT_RECORDING) {
    startRecording(message.streamId, message.config);
  } else if (message.type === MSG.STOP_RECORDING) {
    stopRecording();
  }
});
