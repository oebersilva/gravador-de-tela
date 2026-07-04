import { db } from './db.js';

// ─── DETECT ELECTRON ─────────────────────────────────────────────────────────
const isElectron = typeof window.electronAPI !== 'undefined';

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
const howItWorksBtn       = document.getElementById('how-it-works-btn');
const howItWorksModal     = document.getElementById('how-it-works-modal');
const closeHowBtn         = document.getElementById('close-how-btn');
const btnEntendido        = document.getElementById('btn-entendido');
const systemAudioSelect   = document.getElementById('system-audio-select');


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
let pipWindow      = null;

// Audio context
let audioCtx          = null;
let audioDestination  = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  if (isElectron) {
    if (browserWarning)  browserWarning.style.display  = 'none';
    
    // Electron: bubble commands forwarded from main process
    window.electronAPI.onDoPause(() => togglePauseResume());
    window.electronAPI.onDoStop(() => stopRecording());
  } else {
    checkBrowserCompatibility();
  }

  await requestInitialPermissions();
  await loadDevices();

  // Event listeners
  cameraSelect.addEventListener('change', handleCameraChange);
  micSelect.addEventListener('change', handleMicChange);
  startBtn.addEventListener('click', handleStartClick);
  stopBtn.addEventListener('click', stopRecording);
  cancelBtn.addEventListener('click', cancelRecording);

  // How It Works Modal Listeners
  if (howItWorksBtn && howItWorksModal) {
    howItWorksBtn.addEventListener('click', (e) => {
      e.preventDefault();
      howItWorksModal.classList.remove('hidden');
    });
    
    closeHowBtn?.addEventListener('click', () => {
      howItWorksModal.classList.add('hidden');
    });
    
    btnEntendido?.addEventListener('click', () => {
      howItWorksModal.classList.add('hidden');
    });

    // Close when clicking outside of modal content
    howItWorksModal.addEventListener('click', (e) => {
      if (e.target === howItWorksModal) {
        howItWorksModal.classList.add('hidden');
      }
    });
  }

  // DB init (IndexedDB, used for share.html player)
  try {
    await db.init();
  } catch (err) {
    console.error('IndexedDB init error:', err);
  }
}

// ─── WEB APP WARNING / COMPATIBILITY CHECK ──────────────────────────────────
function checkBrowserCompatibility() {
  if (browserWarning) {
    if (!('documentPictureInPicture' in window)) {
      browserWarning.classList.remove('hidden');
      browserWarning.innerHTML = `
        <i data-lucide="alert-triangle" class="icon-violet"></i>
        <div>
          <strong>Aviso de Compatibilidade:</strong> Seu navegador atual não oferece suporte completo para a Document Picture-in-Picture API. A bolha de câmera flutuante fora do navegador pode não funcionar corretamente. Recomendamos usar o <strong>Google Chrome</strong> ou <strong>Microsoft Edge (v116+)</strong>.
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    } else {
      browserWarning.classList.add('hidden');
    }
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
async function handleStartClick() {
  if (isElectron) {
    // Show screen source picker then record
    await showElectronSourcePicker();
  } else {
    // Web fallback: use getDisplayMedia directly
    await startRecording(null);
  }
}

// ─── ELECTRON: SCREEN SOURCE PICKER ──────────────────────────────────────────
async function showElectronSourcePicker() {
  let sources;
  try {
    sources = await window.electronAPI.getScreenSources();
  } catch (err) {
    console.error('Source fetch error:', err);
    alert('Não foi possível listar as telas disponíveis.');
    return;
  }

  // Build modal
  const overlay = document.createElement('div');
  overlay.id = 'source-picker-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999; backdrop-filter: blur(6px);
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background: #1a1730; border-radius: 20px; padding: 28px;
    max-width: 680px; width: 90%; border: 1px solid rgba(139,92,246,0.3);
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
  `;

  box.innerHTML = `
    <h2 style="color:#f3f4f6;font-family:'Outfit',system-ui,sans-serif;
                margin:0 0 6px;font-size:20px;font-weight:700">
      Escolha o que gravar
    </h2>
    <p style="color:rgba(255,255,255,.45);font-family:'Outfit',system-ui,sans-serif;
              margin:0 0 20px;font-size:13px">
      Selecione um monitor ou janela específica
    </p>
    <div id="source-grid" style="
      display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
      gap:12px;max-height:360px;overflow-y:auto;padding-right:4px
    "></div>
    <div style="margin-top:20px;text-align:right">
      <button id="src-cancel-btn" style="
        background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.6);
        border:1px solid rgba(255,255,255,0.12);border-radius:10px;
        padding:8px 20px;cursor:pointer;font-family:'Outfit',system-ui;font-size:14px
      ">Cancelar</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const grid = box.querySelector('#source-grid');

  sources.forEach(source => {
    const card = document.createElement('button');
    card.style.cssText = `
      background: rgba(255,255,255,0.04); border: 1.5px solid rgba(255,255,255,0.1);
      border-radius: 12px; padding: 8px; cursor: pointer; text-align: center;
      transition: border-color 0.15s, background 0.15s; display: flex;
      flex-direction: column; align-items: center; gap: 8px; width: 100%;
    `;
    card.innerHTML = `
      <img src="${source.thumbnail}" style="
        width:100%;border-radius:6px;aspect-ratio:16/9;object-fit:cover;
        border:1px solid rgba(255,255,255,0.1)
      "/>
      <span style="
        color:#d1d5db;font-family:'Outfit',system-ui;font-size:12px;
        font-weight:500;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;width:100%;padding:0 4px
      ">${source.name}</span>
    `;

    card.addEventListener('mouseenter', () => {
      card.style.borderColor = '#8b5cf6';
      card.style.background  = 'rgba(139,92,246,0.12)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'rgba(255,255,255,0.1)';
      card.style.background  = 'rgba(255,255,255,0.04)';
    });
    card.addEventListener('click', () => {
      overlay.remove();
      startRecording(source.id);
    });

    grid.appendChild(card);
  });

  box.querySelector('#src-cancel-btn').addEventListener('click', () => overlay.remove());
}

// ─── MAIN RECORDING FUNCTION ─────────────────────────────────────────────────
async function startRecording(sourceId) {
  recordedChunks = [];
  const selectedCameraId = cameraSelect.value;
  const selectedMicId    = micSelect.value;
  const videoQuality     = qualitySelect.value;

  try {
    // 1. Capture screen
    if (isElectron && sourceId) {
      screenStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            maxWidth: 3840,
            minHeight: 720,
            maxHeight: 2160,
            maxFrameRate: videoQuality === '1080p' ? 60 : 30
          }
        }
      });
    } else {
      // Web fallback
      const recordSystemAudio = systemAudioSelect ? systemAudioSelect.value === 'include' : false;
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', frameRate: { ideal: videoQuality === '1080p' ? 60 : 30 } },
        audio: recordSystemAudio,
        systemAudio: recordSystemAudio ? 'include' : 'exclude'
      });
    }

    // 2. Capture mic
    if (selectedMicId !== 'none') {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: selectedMicId, echoCancellation: true, noiseSuppression: true }
      });
    }

    // 3. Mix audio
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

    // 4. Build combined stream (screen video + mixed audio)
    const tracks = [];
    const videoTrack = screenStream.getVideoTracks()[0];
    tracks.push(videoTrack);

    videoTrack.addEventListener('ended', () => {
      if (isRecording) stopRecording();
    });

    if (hasAudio) tracks.push(audioDestination.stream.getAudioTracks()[0]);
    combinedStream = new MediaStream(tracks);

    // 5. Open camera bubble
    if (selectedCameraId !== 'none') {
      if (isElectron) {
        // Desktop: open clean circular floating bubble window via main process (no URLs, stays on top of everything)
        await window.electronAPI.openBubble(selectedCameraId);
      } else {
        // Web: use custom HTML Document PiP bubble with controls (captured in recording)
        await openWebCameraBubble();
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
    mediaRecorder.start(1000);
    isRecording = true;

    // 7. Update UI
    recorderSetup?.classList.add('hidden');
    recordingStatusCard?.classList.remove('hidden');
    startTimer();

  } catch (err) {
    console.error('Recording error:', err);
    cleanupStreams();
    if (isElectron) window.electronAPI.closeBubble().catch(() => {});
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    if (err.name !== 'NotAllowedError') {
      alert('Falha ao iniciar gravação. Verifique as permissões e tente novamente.');
    }
  }
}

// ─── DATA COLLECTION ─────────────────────────────────────────────────────────
function handleDataAvailable(event) {
  if (event.data?.size > 0) recordedChunks.push(event.data);
}

// ─── STOP RECORDING ──────────────────────────────────────────────────────────
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  isPaused    = false;

  stopTimer();
  timerDisplay?.classList.remove('paused');

  if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();

  // Close bubble
  if (isElectron) {
    window.electronAPI.closeBubble().catch(() => {});
  } else {
    if (pipWindow) {
      pipWindow.close();
      pipWindow = null;
    }
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

  if (isElectron) {
    window.electronAPI.closeBubble().catch(() => {});
  } else {
    if (pipWindow) {
      pipWindow.close();
      pipWindow = null;
    }
  }

  cleanupStreams();
  recordingStatusCard?.classList.add('hidden');
  recorderSetup?.classList.remove('hidden');
  handleCameraChange();
}

// ─── HANDLE RECORDING STOP (save/share) ──────────────────────────────────────
async function handleRecordingStop() {
  cleanupStreams();

  const blob    = new Blob(recordedChunks, { type: 'video/webm' });
  const videoId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const videoDate = new Date().toISOString();

  // Progress bar
  let progress = 0;
  uploadProgress.style.width = '0%';
  uploadProgressText.textContent = 'Processando…';

  const tick = setInterval(async () => {
    progress += Math.floor(Math.random() * 15) + 5;
    if (progress >= 100) {
      progress = 100;
      clearInterval(tick);

      // Electron: also offer native save dialog alongside share page
      if (isElectron) {
        const buf = await blob.arrayBuffer();
        const result = await window.electronAPI.saveVideo(buf);
        if (result.success) {
          uploadProgressText.textContent = '✅ Salvo em: ' + result.filePath;
        }
      }

      // Save to IndexedDB
      try {
        if (db) {
          await db.saveVideo({
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
        console.error('Save error:', err);
        if (!isElectron) {
          alert('Erro ao salvar vídeo.');
        }
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

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ─── PAUSE / RESUME ───────────────────────────────────────────────────────────
function togglePauseResume() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  if (!isPaused) {
    mediaRecorder.pause();
    isPaused = true;
    stopTimer();
    timerDisplay?.classList.add('paused');
    if (isElectron) window.electronAPI.notifyPauseState(true);
    updatePipWindowPauseState(true);
  } else {
    mediaRecorder.resume();
    isPaused = false;
    startTimer(true);
    timerDisplay?.classList.remove('paused');
    if (isElectron) window.electronAPI.notifyPauseState(false);
    updatePipWindowPauseState(false);
  }
}

// Expose togglePauseResume globally
window.togglePauseResume = togglePauseResume;

// ─── DOCUMENT PICTURE IN PICTURE (WEB CAMERA BUBBLE) ─────────────────────────
async function openWebCameraBubble() {
  if (!('documentPictureInPicture' in window)) {
    // Fallback to standard Video PiP if Document PiP is unsupported
    if (pipVideoElement) {
      try {
        await pipVideoElement.requestPictureInPicture();
      } catch (e) {
        console.warn('Fallback Video PiP failed:', e);
      }
    }
    return;
  }

  if (pipWindow) {
    pipWindow.close();
  }

  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 220,
      height: 220,
    });

    const pipDocument = pipWindow.document;

    // Copy styles
    [...document.styleSheets].forEach((sheet) => {
      try {
        const cssRules = [...sheet.cssRules].map((r) => r.cssText).join('');
        const style = pipDocument.createElement('style');
        style.textContent = cssRules;
        pipDocument.head.appendChild(style);
      } catch (e) {
        const link = pipDocument.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pipDocument.head.appendChild(link);
      }
    });

    // Body style
    pipDocument.body.style.margin = '0';
    pipDocument.body.style.padding = '0';
    pipDocument.body.style.overflow = 'hidden';
    pipDocument.body.style.background = 'transparent';

    // Container
    const container = pipDocument.createElement('div');
    container.id = 'pip-container';
    container.style.cssText = `
      width: 100vw; height: 100vh;
      position: relative; overflow: hidden; background: #000;
    `;

    // Video
    const video = pipDocument.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = cameraStream;
    video.style.cssText = `
      width: 100vw; height: 100vh; object-fit: cover;
      transform: scaleX(-1); display: block;
    `;
    container.appendChild(video);



    // Styling keyframes and classes
    const style = pipDocument.createElement('style');
    style.textContent = `
      @keyframes pipBlink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      .pip-ctrl-btn {
        width: 32px; height: 32px; border-radius: 50%;
        border: 1.5px solid rgba(255,255,255,0.5);
        background: rgba(0, 0, 0, 0.55); color: white;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: background 0.15s, border-color 0.15s, transform 0.1s;
        padding: 0; outline: none;
      }
      .pip-ctrl-btn svg {
        width: 14px; height: 14px; fill: currentColor;
      }
      .pip-ctrl-btn:hover {
        background: #8b5cf6; border-color: #8b5cf6; transform: scale(1.1);
      }
      .pip-ctrl-btn.stop:hover {
        background: #ef4444; border-color: #ef4444;
      }
    `;
    pipDocument.head.appendChild(style);

    // Controls container
    const controls = pipDocument.createElement('div');
    controls.style.cssText = `
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 64px; border-radius: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%);
      display: flex; align-items: flex-end; justify-content: center;
      gap: 12px; padding-bottom: 18px; opacity: 0; transition: opacity 0.2s ease;
      z-index: 20;
    `;

    // Hover
    container.addEventListener('mouseenter', () => { controls.style.opacity = '1'; });
    container.addEventListener('mouseleave', () => { controls.style.opacity = '0'; });

    // Pause/Resume button
    const pauseBtn = pipDocument.createElement('button');
    pauseBtn.id = 'pip-pause-btn';
    pauseBtn.className = 'pip-ctrl-btn';
    pauseBtn.title = 'Pausar';
    pauseBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    pauseBtn.addEventListener('click', () => {
      togglePauseResume();
    });

    // Stop button
    const stopBtn = pipDocument.createElement('button');
    stopBtn.className = 'pip-ctrl-btn stop';
    stopBtn.title = 'Parar e Salvar';
    stopBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;
    stopBtn.addEventListener('click', () => {
      stopRecording();
    });

    controls.appendChild(pauseBtn);
    controls.appendChild(stopBtn);
    container.appendChild(controls);
    pipDocument.body.appendChild(container);

    pipWindow.addEventListener('unload', () => {
      pipWindow = null;
    });

  } catch (err) {
    console.warn('Failed to open Document PiP:', err);
  }
}

// Update PiP window UI dynamically based on pause/resume state
function updatePipWindowPauseState(paused) {
  if (!pipWindow) return;
  const pipDoc = pipWindow.document;
  const recDot = pipDoc.getElementById('pip-rec-dot');
  const pauseBtn = pipDoc.getElementById('pip-pause-btn');



  if (pauseBtn) {
    const PAUSE_SVG = `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    const PLAY_SVG  = `<svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z" fill="currentColor"/></svg>`;
    pauseBtn.innerHTML = paused ? PLAY_SVG : PAUSE_SVG;
    pauseBtn.title = paused ? 'Retomar' : 'Pausar';
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
