const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Screen recording
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),

  // Bubble window control
  openBubble: (cameraDeviceId) => ipcRenderer.invoke('open-bubble', cameraDeviceId),
  closeBubble: () => ipcRenderer.invoke('close-bubble'),

  // Save video to disk (native Windows dialog)
  saveVideo: (arrayBuffer) => ipcRenderer.invoke('save-video', arrayBuffer),
  showFile: (filePath) => ipcRenderer.invoke('show-file', filePath),

  // Bubble → Main signals
  bubblePause: () => ipcRenderer.send('bubble-pause'),
  bubbleStop: () => ipcRenderer.send('bubble-stop'),

  // Main → Bubble: camera init
  onInitCamera: (callback) => ipcRenderer.on('init-camera', (_e, deviceId) => callback(deviceId)),

  // Main → Bubble: recording state changes
  onRecordingPaused: (callback) => ipcRenderer.on('recording-paused', (_e, isPaused) => callback(isPaused)),

  // Main → Main: triggered by bubble controls
  onDoPause: (callback) => ipcRenderer.on('do-pause', () => callback()),
  onDoStop: (callback) => ipcRenderer.on('do-stop', () => callback()),

  // Notify main process about pause state (so it can forward to bubble)
  notifyPauseState: (isPaused) => ipcRenderer.send('recording-paused', isPaused),
});
