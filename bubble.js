// bubble.js — Logic for the transparent floating camera bubble window

const video   = document.getElementById('cam-video');
const noCam   = document.getElementById('no-cam');
const bubble  = document.getElementById('bubble');
const pauseBtn = document.getElementById('pause-btn');
const pauseIcon = document.getElementById('pause-icon');
const stopBtn  = document.getElementById('stop-btn');

let isPaused = false;

// ─── PAUSE ICON HELPERS ───────────────────────────────────────────────────────
const PAUSE_SVG = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
const PLAY_SVG  = `<path d="M5 3l14 9-14 9V3z"/>`;

function setPauseIcon(paused) {
  pauseIcon.innerHTML = paused ? PLAY_SVG : PAUSE_SVG;
  pauseBtn.title = paused ? 'Retomar' : 'Pausar';
  bubble.classList.toggle('paused', paused);
}

// ─── CAMERA INIT ─────────────────────────────────────────────────────────────
async function startCamera(deviceId) {
  try {
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.style.display = 'block';
    noCam.style.display = 'none';
  } catch (err) {
    console.error('Bubble: camera error', err);
    video.style.display = 'none';
    noCam.style.display = 'flex';
  }
}

// Receive camera device ID from main process
window.electronAPI.onInitCamera((deviceId) => {
  startCamera(deviceId);
});

// Fallback: try default camera immediately (in case message already arrived)
startCamera(null);

// ─── PAUSE STATE FROM MAIN ────────────────────────────────────────────────────
window.electronAPI.onRecordingPaused((paused) => {
  isPaused = paused;
  setPauseIcon(paused);
});

// ─── BUTTON ACTIONS ───────────────────────────────────────────────────────────
pauseBtn.addEventListener('click', () => {
  window.electronAPI.bubblePause();
});

stopBtn.addEventListener('click', () => {
  window.electronAPI.bubbleStop();
});
