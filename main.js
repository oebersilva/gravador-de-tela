const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow = null;
let bubbleWindow = null;
const isDev = process.argv.includes('--dev');

// ─── MAIN WINDOW ────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 800,
    minHeight: 580,
    backgroundColor: '#0b0a13',
    titleBarStyle: 'hiddenInset',
    frame: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false          // allow loading local video blobs in share.html
    }
  });

  mainWindow.loadFile('index.html');

  if (isDev) mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.close();
    mainWindow = null;
  });
}

// ─── BUBBLE WINDOW ───────────────────────────────────────────────────────────
function createBubbleWindow(cameraDeviceId) {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.close();
  }

  bubbleWindow = new BrowserWindow({
    width: 220,
    height: 220,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Stay on top of everything, including fullscreen windows
  bubbleWindow.setAlwaysOnTop(true, 'screen-saver');
  bubbleWindow.setVisibleOnAllWorkspaces(true);

  // Position at bottom-right corner, away from edges
  const { width: sw, height: sh } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  bubbleWindow.setPosition(sw - 250, sh - 280);

  bubbleWindow.loadFile('bubble.html');

  // Once loaded, send camera device ID
  bubbleWindow.webContents.on('did-finish-load', () => {
    bubbleWindow.webContents.send('init-camera', cameraDeviceId);
  });

  bubbleWindow.on('closed', () => {
    bubbleWindow = null;
  });

  return bubbleWindow;
}

// ─── PERMISSIONS ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Grant all media permissions automatically
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return true;
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: SCREEN SOURCES ─────────────────────────────────────────────────────
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 }
  });

  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  }));
});

// ─── IPC: BUBBLE CONTROL ─────────────────────────────────────────────────────
ipcMain.handle('open-bubble', (_event, cameraDeviceId) => {
  createBubbleWindow(cameraDeviceId);
  return true;
});

ipcMain.handle('close-bubble', () => {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.close();
  return true;
});

// Bubble → Main: pause/stop forwarding
ipcMain.on('bubble-pause', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('do-pause');
  }
});

ipcMain.on('bubble-stop', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('do-stop');
  }
});

// Main → Bubble: reflect pause state
ipcMain.on('recording-paused', (_event, isPaused) => {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('recording-paused', isPaused);
  }
});

// ─── IPC: SAVE FILE DIALOG ───────────────────────────────────────────────────
ipcMain.handle('save-video', async (_event, arrayBuffer) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar Gravação',
    defaultPath: path.join(os.homedir(), 'Videos', `Loomify_${Date.now()}.webm`),
    filters: [
      { name: 'Vídeo WebM', extensions: ['webm'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  });

  if (canceled || !filePath) return { success: false };

  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer);
  return { success: true, filePath };
});

// ─── IPC: OPEN FILE IN EXPLORER ──────────────────────────────────────────────
ipcMain.handle('show-file', (_event, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});
