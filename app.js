// app.js — Web Screen Recorder using standard Video Picture-in-Picture

// ─── DOM ELEMENTS ─────────────────────────────────────────────────────────────
const cameraSelect        = document.getElementById('camera-select');
const micSelect           = document.getElementById('mic-select');
const qualitySelect       = document.getElementById('quality-select');
const startBtn            = document.getElementById('start-btn');
const stopBtn             = document.getElementById('stop-btn');
const cancelBtn           = document.getElementById('cancel-btn');
const recorderSetup       = document.getElementById('recorder-setup');
const recordingStatusCard = document.getElementById('recording-status-card');
const browserWarning      = document.getElementById('browser-warning');
const uploadModal         = document.getElementById('upload-modal');
const uploadProgress      = document.getElementById('upload-progress');
const uploadProgressText  = document.getElementById('upload-progress-text');
const webcamPreview       = document.getElementById('webcam-preview');
const previewPlaceholder  = document.getElementById('preview-placeholder');
const timerDisplay        = document.getElementById('timer');
const systemStatus        = document.getElementById('system-status');
const pipVideoElement     = document.getElementById('pip-video-element');

// ─── APPLICATION STATE ────────────────────────────────────────────────────────
let cameraStream   = null;
let micStream      = null;
let screenStream   = null;
let combinedStream = null;
let mediaRecorder  = null;
let recordedChunks = [];
let timerInterval  = null;
let secondsRecorded = 0;
let isRecording    = false;
let isPaused       = false;

// Audio context for mixing
let audioCtx          = null;
let audioDestination  = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  checkBrowserSupport();
  await requestInitialPermissions();
  await loadDevices();

  // Event listeners
  cameraSelect.addEventListener('change', handleCameraChange);
  micSelect.addEventListener('change', handleMicChange);
  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
  cancelBtn.addEventListener('click', cancelRecording);

  // Initialize DB (IndexedDB)
  try {
    await window.db.init();
  } catch (err) {
    console.error('IndexedDB init error:', err);
  }
}

// ─── BROWSER SUPPORT CHECK ────────────────────────────────────────────────────
function checkBrowserSupport() {
  // Check if standard Picture-in-Picture is supported
  const isPipSupported = 'pictureInPictureEnabled' in document;
  if (!isPipSupported) {
    browserWarning?.classList.remove('hidden');
    browserWarning.innerHTML = `
      <i data-lucide="alert-triangle"></i>
      <div>
        <strong>Aviso de Compatibilidade:</strong> Seu navegador não suporta Picture-in-Picture. A câmera flutuante retangular não poderá se sobrepor a outros programas.
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }
}

// ─── PERMISSIONS ─────────────────────────────────────────────────────────────
async function requestInitialPermissions() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    s.getTracks().forEach(t => t.stop());
  } catch (err) {
    console.warn('Initial permissions denied:', err);
  }
}

// ─── DEVICE LOADING ──────────────────────────────────────────────────────────
async function loadDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();

    cameraSelect.innerHTML = '';
    micSelect.innerHTML    = '';

    let camIdx = 0, micIdx = 0;

    // "None" options
    const noneCamera     = document.createElement('option');
    noneCamera.value     = 'none';
    noneCamera.textContent = 'Sem câmera (Apenas Tela)';
    cameraSelect.appendChild(noneCamera);

    const noneMic        = document.createElement('option');
    noneMic.value        = 'none';
    noneMic.textContent  = 'Sem microfone (Mudo)';
    micSelect.appendChild(noneMic);

    devices.forEach(d => {
      const opt    = document.createElement('option');
      opt.value    = d.deviceId;
      if (d.kind === 'videoinput') {
        opt.textContent = d.label || `Câmera ${++camIdx}`;
        cameraSelect.appendChild(opt);
      } else if (d.kind === 'audioinput') {
        opt.textContent = d.label || `Microfone ${++micIdx}`;
        micSelect.appendChild(opt);
      }
    });

    if (cameraSelect.options.length > 1) cameraSelect.selectedIndex = 1;
    if (micSelect.options.length   > 1) micSelect.selectedIndex   = 1;

    handleCameraChange();
  } catch (err) {
    console.error('Device load error:', err);
    if (systemStatus) {
      systemStatus.className = 'status-indicator error';
      systemStatus.innerHTML = '<span class="dot" style="background-color:var(--color-danger)"></span>Erro de Permissão';
    }
  }
}

// ─── CAMERA PREVIEW ──────────────────────────────────────────────────────────
async function handleCameraChange() {
  const deviceId = cameraSelect.value;

  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }

  if (deviceId === 'none') {
    webcamPreview?.classList.add('hidden');
    previewPlaceholder?.classList.remove('hidden');
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId },
      audio: false
    });
    webcamPreview.srcObject = cameraStream;
    if (pipVideoElement) {
      pipVideoElement.srcObject = cameraStream;
    }
    webcamPreview?.classList.remove('hidden');
    previewPlaceholder?.classList.add('hidden');
  } catch (err) {
    console.error('Camera preview error:', err);
    webcamPreview?.classList.add('hidden');
    previewPlaceholder?.classList.remove('hidden');
  }
}

function handleMicChange() { /* no-op */ }

// ─── START RECORDING FLOW ─────────────────────────────────────────────────────
async function startRecording() {
  recordedChunks = [];
  const selectedCameraId = cameraSelect.value;
  const selectedMicId    = micSelect.value;
  const videoQuality     = qualitySelect.value;

  try {
    // 1. Capture screen with user prompt (includes tab / screen / window choice + system audio request)
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        frameRate: { ideal: videoQuality === '1080p' ? 60 : 30 }
      },
      audio: true,
      systemAudio: 'include'
    });

    // 2. Capture mic stream if selected
    if (selectedMicId !== 'none') {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: selectedMicId, echoCancellation: true, noiseSuppression: true }
      });
    }

    // 3. Audio mixing using Web Audio API
    audioCtx         = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
    audioDestination = audioCtx.createMediaStreamDestination();
    let hasAudio     = false;

    if (micStream?.getAudioTracks().length > 0) {
      audioCtx.createMediaStreamSource(micStream).connect(audioDestination);
      hasAudio = true;
    }
    if (screenStream?.getAudioTracks().length > 0) {
      audioCtx.createMediaStreamSource(screenStream).connect(audioDestination);
      hasAudio = true;
    }

    // 4. Assemble combined stream
    const tracks = [];
    const videoTrack = screenStream.getVideoTracks()[0];
    tracks.push(videoTrack);

    // If user stops sharing screen using Chrome's native stop bar, handle it gracefully
    videoTrack.addEventListener('ended', () => {
      if (isRecording) stopRecording();
    });

    if (hasAudio) {
      tracks.push(audioDestination.stream.getAudioTracks()[0]);
    }
    combinedStream = new MediaStream(tracks);

    // 5. Open webcam in standard Video PiP (Clean rectangular box, no URL bar!)
    if (selectedCameraId !== 'none' && pipVideoElement) {
      try {
        // Request PiP on the off-screen video element showing the camera stream
        await pipVideoElement.requestPictureInPicture();
      } catch (pipErr) {
        console.warn('Could not launch Video PiP automatically:', pipErr);
        alert('Por favor, ative o Picture-in-Picture se a câmera flutuante não abrir.');
      }
    }

    // 6. Setup MediaRecorder
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';
    mediaRecorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onstop          = handleRecordingStop;
    
    // Start recording chunks
    mediaRecorder.start(1000);
    isRecording = true;

    // 7. Update UI to recording mode
    recorderSetup?.classList.add('hidden');
    recordingStatusCard?.classList.remove('hidden');
    startTimer();

  } catch (err) {
    console.error('Recording start error:', err);
    cleanupStreams();
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    if (err.name !== 'NotAllowedError') {
      alert('Falha ao iniciar gravação. Certifique-se de conceder permissões de tela e áudio.');
    }
  }
}

// ─── DATA COLLECTION ─────────────────────────────────────────────────────────
function handleDataAvailable(event) {
  if (event.data?.size > 0) {
    recordedChunks.push(event.data);
  }
}

// ─── STOP RECORDING ──────────────────────────────────────────────────────────
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  isPaused    = false;

  stopTimer();
  timerDisplay?.classList.remove('paused');

  if (mediaRecorder?.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Exit Video PiP
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(err => console.warn('Error exiting PiP:', err));
  }

  recordingStatusCard?.classList.add('hidden');
  uploadModal?.classList.remove('hidden');
}

// ─── CANCEL RECORDING ────────────────────────────────────────────────────────
function cancelRecording() {
  if (!confirm('Tem certeza que deseja cancelar e descartar esta gravação?')) return;

  isRecording = false;
  isPaused    = false;
  stopTimer();

  if (mediaRecorder?.state !== 'inactive') {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.stop();
  }

  // Exit Video PiP
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }

  cleanupStreams();
  recordingStatusCard?.classList.add('hidden');
  recorderSetup?.classList.remove('hidden');
  handleCameraChange();
}

// ─── PROCESS AND SAVE VIDEO ──────────────────────────────────────────────────
async function handleRecordingStop() {
  cleanupStreams();

  const blob      = new Blob(recordedChunks, { type: 'video/webm' });
  const videoId   = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const videoDate = new Date().toISOString();

  // Progress animation
  let progress = 0;
  uploadProgress.style.width = '0%';
  uploadProgressText.textContent = 'Processando vídeo…';

  const tick = setInterval(async () => {
    progress += Math.floor(Math.random() * 15) + 5;
    if (progress >= 100) {
      progress = 100;
      clearInterval(tick);

      // Save to IndexedDB
      try {
        if (window.db) {
          await window.db.saveVideo({
            id: videoId,
            title: `Gravação de Tela — ${new Date().toLocaleDateString('pt-BR')}`,
            blob,
            date: videoDate,
            views: 1,
            comments: []
          });
          window.location.href = `share.html?id=${videoId}`;
        }
      } catch (err) {
        console.error('Save to IndexedDB error:', err);
        alert('Erro ao salvar o vídeo localmente.');
        uploadModal?.classList.add('hidden');
        recorderSetup?.classList.remove('hidden');
        handleCameraChange();
      }
    }
    uploadProgress.style.width    = `${progress}%`;
    uploadProgressText.textContent = `${progress}% completo`;
  }, 150);
}

// ─── STREAMS CLEANUP ─────────────────────────────────────────────────────────
function cleanupStreams() {
  screenStream?.getTracks().forEach(t => t.stop());
  screenStream = null;
  micStream?.getTracks().forEach(t => t.stop());
  micStream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
}

// ─── TIMER ───────────────────────────────────────────────────────────────────
function startTimer(isResume = false) {
  if (!isResume) {
    secondsRecorded = 0;
    timerDisplay.textContent = '00:00';
  }
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secondsRecorded++;
    const m = String(Math.floor(secondsRecorded / 60)).padStart(2, '0');
    const s = String(secondsRecorded % 60).padStart(2, '0');
    timerDisplay.textContent = `${m}:${s}`;
  }, 1000);
}

// ─── PAUSE / RESUME ───────────────────────────────────────────────────────────
function togglePauseResume() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  if (!isPaused) {
    mediaRecorder.pause();
    isPaused = true;
    clearInterval(timerInterval);
    timerInterval = null;
    timerDisplay?.classList.add('paused');
  } else {
    mediaRecorder.resume();
    isPaused = false;
    startTimer(true);
    timerDisplay?.classList.remove('paused');
  }
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// Expose controls to window
window.togglePauseResume = togglePauseResume;

// ─── BOOT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
