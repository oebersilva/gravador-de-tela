import { db } from './db.js';

// DOM Elements
const cameraSelect = document.getElementById('camera-select');
const micSelect = document.getElementById('mic-select');
const qualitySelect = document.getElementById('quality-select');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const cancelBtn = document.getElementById('cancel-btn');
const recorderSetup = document.getElementById('recorder-setup');
const recordingStatusCard = document.getElementById('recording-status-card');
const browserWarning = document.getElementById('browser-warning');
const uploadModal = document.getElementById('upload-modal');
const uploadProgress = document.getElementById('upload-progress');
const uploadProgressText = document.getElementById('upload-progress-text');
const webcamPreview = document.getElementById('webcam-preview');
const previewPlaceholder = document.getElementById('preview-placeholder');
const timerDisplay = document.getElementById('timer');
const systemStatus = document.getElementById('system-status');

// Application State
let cameraStream = null;
let micStream = null;
let screenStream = null;
let combinedStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let timerInterval = null;
let secondsRecorded = 0;
let pipWindow = null;
let isRecording = false;
let isPaused = false;

// Audio Context for mixing
let audioCtx = null;
let audioDestination = null;

// Initialize App
async function init() {
  checkBrowserSupport();
  await requestInitialPermissions();
  await loadDevices();
  
  // Event Listeners
  cameraSelect.addEventListener('change', handleCameraChange);
  micSelect.addEventListener('change', handleMicChange);
  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
  cancelBtn.addEventListener('click', cancelRecording);

  // Initialize DB
  try {
    await db.init();
  } catch (err) {
    console.error("Erro ao inicializar IndexedDB:", err);
  }
}

// Check if Document Picture-in-Picture is supported
function checkBrowserSupport() {
  const isDocumentPipSupported = 'documentPictureInPicture' in window;
  if (!isDocumentPipSupported) {
    browserWarning.classList.remove('hidden');
  }
}

// Request initial mic and camera permissions to populate labels
async function requestInitialPermissions() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    // Stop tracks immediately after getting permission
    tempStream.getTracks().forEach(track => track.stop());
  } catch (err) {
    console.warn("Permissões iniciais negadas. Os nomes dos dispositivos podem não estar disponíveis.", err);
  }
}

// Load Camera and Mic options into select fields
async function loadDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    // Clear select fields
    cameraSelect.innerHTML = '';
    micSelect.innerHTML = '';
    
    let cameraCount = 0;
    let micCount = 0;

    // Add "None/Disabled" options
    const noCameraOpt = document.createElement('option');
    noCameraOpt.value = 'none';
    noCameraOpt.textContent = 'Sem câmera (Apenas Tela)';
    cameraSelect.appendChild(noCameraOpt);

    const noMicOpt = document.createElement('option');
    noMicOpt.value = 'none';
    noMicOpt.textContent = 'Sem microfone (Mudo)';
    micSelect.appendChild(noMicOpt);

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      
      if (device.kind === 'videoinput') {
        cameraCount++;
        option.textContent = device.label || `Câmera ${cameraCount}`;
        cameraSelect.appendChild(option);
      } else if (device.kind === 'audioinput') {
        micCount++;
        option.textContent = device.label || `Microfone ${micCount}`;
        micSelect.appendChild(option);
      }
    });

    // Select first available options
    if (cameraSelect.options.length > 1) {
      cameraSelect.selectedIndex = 1; // Select first real camera
    }
    if (micSelect.options.length > 1) {
      micSelect.selectedIndex = 1; // Select first real mic
    }

    // Trigger initial preview
    handleCameraChange();

  } catch (err) {
    console.error("Erro ao carregar dispositivos de mídia:", err);
    systemStatus.className = 'status-indicator error';
    systemStatus.innerHTML = '<span class="dot" style="background-color: var(--color-danger)"></span>Erro de Permissão';
  }
}

// Handle camera selection change
async function handleCameraChange() {
  const deviceId = cameraSelect.value;
  
  // Stop existing preview stream
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  if (deviceId === 'none') {
    webcamPreview.classList.add('hidden');
    previewPlaceholder.classList.remove('hidden');
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceId },
      audio: false
    });
    
    webcamPreview.srcObject = cameraStream;
    webcamPreview.classList.remove('hidden');
    previewPlaceholder.classList.add('hidden');
  } catch (err) {
    console.error("Erro ao iniciar preview da câmera:", err);
    webcamPreview.classList.add('hidden');
    previewPlaceholder.classList.remove('hidden');
  }
}

// Handle microphone selection change (no-op unless active recording adjustments needed)
function handleMicChange() {
  // Mic change doesn't require immediate visual preview update
}

// Main Recording Loop
async function startRecording() {
  recordedChunks = [];
  const selectedCameraId = cameraSelect.value;
  const selectedMicId = micSelect.value;
  const videoQuality = qualitySelect.value;

  try {
    // 1. Request Screen Capture Stream
    const displayOptions = {
      video: {
        cursor: "always",
        displaySurface: "monitor",
        frameRate: { ideal: videoQuality === '1080p' ? 60 : 30 }
      },
      audio: true,
      systemAudio: "include" // Sugerir áudio do sistema
    };
    
    screenStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);

    // 2. Request Mic Capture Stream if selected
    if (selectedMicId !== 'none') {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: selectedMicId }
      });
    }

    // 3. Audio Mixing using Web Audio API
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume(); // Garantir que o contexto está ativo
    audioDestination = audioCtx.createMediaStreamDestination();
    let hasAudioTrack = false;

    if (micStream && micStream.getAudioTracks().length > 0) {
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(audioDestination);
      hasAudioTrack = true;
    }

    if (screenStream && screenStream.getAudioTracks().length > 0) {
      const screenAudioSource = audioCtx.createMediaStreamSource(screenStream);
      screenAudioSource.connect(audioDestination);
      hasAudioTrack = true;
    }

    // 4. Create combined media stream (Screen video + mixed audio)
    const combinedTracks = [];
    
    // Add screen video track
    const screenVideoTrack = screenStream.getVideoTracks()[0];
    combinedTracks.push(screenVideoTrack);

    // Handle when user stops sharing via native browser bar
    screenVideoTrack.addEventListener('ended', () => {
      if (isRecording) {
        stopRecording();
      }
    });

    // Add mixed audio track
    if (hasAudioTrack) {
      const mixedAudioTrack = audioDestination.stream.getAudioTracks()[0];
      combinedTracks.push(mixedAudioTrack);
    }

    combinedStream = new MediaStream(combinedTracks);

    // 5. Initialize camera in Document Picture-in-Picture
    if (selectedCameraId !== 'none') {
      await openCameraBubble(selectedCameraId);
    }

    // 6. Setup MediaRecorder
    let options = { mimeType: 'video/webm;codecs=vp9,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm;codecs=vp8,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options = { mimeType: 'video/mp4' }; // Fallback to mp4
        }
      }
    }

    mediaRecorder = new MediaRecorder(combinedStream, options);
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onstop = handleRecordingStop;

    // Start recording
    mediaRecorder.start(1000); // chunk every second
    isRecording = true;

    // 7. Update UI
    recorderSetup.classList.add('hidden');
    recordingStatusCard.classList.remove('hidden');
    startTimer();

  } catch (err) {
    console.error("Erro ao iniciar gravação:", err);
    cleanupStreams();
    alert("Falha ao iniciar gravação. Certifique-se de dar permissões de tela e áudio.");
  }
}

// Open Camera Bubble in Picture in Picture
async function openCameraBubble(deviceId) {
  try {
    // If the browser supports Document PiP
    if ('documentPictureInPicture' in window) {
      // Re-fetch camera stream to make sure it's active for PiP
      if (!cameraStream) {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: deviceId },
          audio: false
        });
      }

      // Request PiP window (always-on-top, custom size)
      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 240,
        height: 240,
      });

      // Handle manually closed window
      pipWindow.addEventListener('pagehide', () => {
        pipWindow = null;
      });

      // Inject parent CSS rules to style inside the PiP bubble
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = pipWindow.document.createElement('style');
          style.textContent = cssRules;
          pipWindow.document.head.appendChild(style);
        } catch (e) {
          const link = pipWindow.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = styleSheet.href;
          pipWindow.document.head.appendChild(link);
        }
      });

      // Set body styling
      pipWindow.document.body.className = 'pip-body';

      // Camera container (full-size, takes all available vertical space)
      const pipContainer = pipWindow.document.createElement('div');
      pipContainer.className = 'pip-camera-container';

      // Video element - full width, mirrored
      const pipVideo = pipWindow.document.createElement('video');
      pipVideo.className = 'pip-video';
      pipVideo.autoplay = true;
      pipVideo.muted = true;
      pipVideo.playsInline = true;
      pipVideo.srcObject = cameraStream;

      pipContainer.appendChild(pipVideo);

      // Status bar at the bottom (outside pipContainer, sibling)
      const pipStatusBar = pipWindow.document.createElement('div');
      pipStatusBar.className = 'pip-status-bar';

      // Left side: dot + label
      const statusLeft = pipWindow.document.createElement('div');
      statusLeft.className = 'pip-status-left';

      const statusDot = pipWindow.document.createElement('span');
      statusDot.className = 'pip-overlay-dot';

      const statusLabel = pipWindow.document.createElement('span');
      statusLabel.className = 'pip-status-label';
      statusLabel.textContent = 'Gravando';

      statusLeft.appendChild(statusDot);
      statusLeft.appendChild(statusLabel);

      // Right side: Pause + Stop buttons
      const statusRight = pipWindow.document.createElement('div');
      statusRight.className = 'pip-status-right';

      const pipPauseBtn = pipWindow.document.createElement('button');
      pipPauseBtn.className = 'pip-control-btn btn-pause';
      pipPauseBtn.title = 'Pausar';
      pipPauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

      const pipStopBtn = pipWindow.document.createElement('button');
      pipStopBtn.className = 'pip-control-btn btn-stop';
      pipStopBtn.title = 'Parar e Salvar';
      pipStopBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;

      pipPauseBtn.addEventListener('click', () => togglePauseResume(pipPauseBtn, statusLabel, statusDot));
      pipStopBtn.addEventListener('click', () => stopRecording());

      statusRight.appendChild(pipPauseBtn);
      statusRight.appendChild(pipStopBtn);

      pipStatusBar.appendChild(statusLeft);
      pipStatusBar.appendChild(statusRight);

      // Assemble into PiP body: video on top, status bar pinned to bottom
      pipWindow.document.body.appendChild(pipContainer);
      pipWindow.document.body.appendChild(pipStatusBar);

      // Save a global reference
      window.activePipWindow = pipWindow;

    } else {
      // Fallback: Use standard video Picture-in-Picture
      // This will open a square native video overlay
      console.warn("Document Picture-in-Picture não suportado. Usando PiP de vídeo padrão.");
      if (webcamPreview) {
        await webcamPreview.requestPictureInPicture();
      }
    }
  } catch (err) {
    console.error("Falha ao abrir bolha da câmera:", err);
  }
}

// Media Recorder Chunk Collector
function handleDataAvailable(event) {
  if (event.data && event.data.size > 0) {
    recordedChunks.push(event.data);
  }
}

// Stop Recording
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  stopTimer();
  
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Close PiP Bubble
  if (pipWindow) {
    pipWindow.close();
    pipWindow = null;
    window.activePipWindow = null;
  }
  
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(console.error);
  }

  // UI transition
  recordingStatusCard.classList.add('hidden');
  uploadModal.classList.remove('hidden');
}

// Stop recording and discard data
function cancelRecording() {
  if (!confirm("Tem certeza que deseja cancelar e excluir esta gravação?")) return;
  
  isRecording = false;
  stopTimer();

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.ondataavailable = null; // discard incoming data
    mediaRecorder.stop();
  }

  if (pipWindow) {
    pipWindow.close();
    pipWindow = null;
    window.activePipWindow = null;
  }

  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(console.error);
  }

  cleanupStreams();
  
  recordingStatusCard.classList.add('hidden');
  recorderSetup.classList.remove('hidden');
  
  // Re-enable local preview
  handleCameraChange();
}

// Processing and Saving Video to "Cloud"
async function handleRecordingStop() {
  cleanupStreams();

  // Create Video Blob
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const videoId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
  const videoDate = new Date().toISOString();
  
  // Simulate Cloud Upload Progress
  let progress = 0;
  uploadProgress.style.width = '0%';
  uploadProgressText.textContent = '0% completo';

  const progressInterval = setInterval(async () => {
    progress += Math.floor(Math.random() * 15) + 5;
    if (progress >= 100) {
      progress = 100;
      clearInterval(progressInterval);
      
      // Save to local IndexedDB (cloud mock)
      try {
        await db.saveVideo({
          id: videoId,
          title: `Gravação de Tela - ${new Date().toLocaleDateString('pt-BR')}`,
          blob: blob,
          date: videoDate,
          views: 1,
          comments: []
        });

        // Redirect to sharing page
        window.location.href = `share.html?id=${videoId}`;
      } catch (err) {
        console.error("Erro ao salvar vídeo:", err);
        alert("Erro ao salvar vídeo localmente. Verifique o espaço no disco.");
        uploadModal.classList.add('hidden');
        recorderSetup.classList.remove('hidden');
        handleCameraChange();
      }
    }
    uploadProgress.style.width = `${progress}%`;
    uploadProgressText.textContent = `${progress}% completo`;
  }, 150);
}

// Cleanup all active tracks & audio contexts
function cleanupStreams() {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  // Keep cameraStream for preview setup page, but if recording clean it up if needed
  if (audioCtx) {
    audioCtx.close().catch(console.error);
    audioCtx = null;
  }
}

// Timer management
function startTimer(isResume = false) {
  if (!isResume) {
    secondsRecorded = 0;
    timerDisplay.textContent = '00:00';
  }
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimer() {
  secondsRecorded++;
  const mins = Math.floor(secondsRecorded / 60).toString().padStart(2, '0');
  const secs = (secondsRecorded % 60).toString().padStart(2, '0');
  timerDisplay.textContent = `${mins}:${secs}`;
}

// Pause and Resume logic
function togglePauseResume(pipPauseBtn, statusLabel, statusDot) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  if (!isPaused) {
    mediaRecorder.pause();
    isPaused = true;
    stopTimer();
    
    // Update pause button to "play" icon
    if (pipPauseBtn) {
      pipPauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>`;
      pipPauseBtn.title = 'Retomar';
    }

    // Update status bar
    if (statusLabel) statusLabel.textContent = 'Pausado';
    if (statusDot) statusDot.style.background = '#f59e0b'; // amber

    // Blink the main page timer
    timerDisplay.classList.add('paused');

  } else {
    mediaRecorder.resume();
    isPaused = false;
    startTimer(true);
    
    // Update pause button back to "pause" icon
    if (pipPauseBtn) {
      pipPauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      pipPauseBtn.title = 'Pausar';
    }

    // Restore status bar
    if (statusLabel) statusLabel.textContent = 'Gravando';
    if (statusDot) statusDot.style.background = '#ef4444'; // red

    // Remove blinking
    timerDisplay.classList.remove('paused');
  }
}

// Initialize Application on load
window.addEventListener('DOMContentLoaded', init);
