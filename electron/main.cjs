const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow = null;
let backendServer = null;

async function createWindow() {
  const userDataDir = app.getPath('userData');
  process.env.LUMINA_EMBEDDED = '1';
  process.env.LUMINA_DATA_DIR = userDataDir;
  process.env.LUMINA_CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

  const serverEntry = path.join(__dirname, '..', 'server', 'dist', 'index.js');
  const { startServer } = await import(pathToFileURL(serverEntry).href);
  const { server, port } = await startServer(0);
  backendServer = server;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Lumina Vault — AI Photo & Video Organizer',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('lumina:pick-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Photo & Video Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (backendServer) {
    try {
      backendServer.close();
    } catch {
      // ignore
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
