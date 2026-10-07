import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import path from 'node:path';
import type { MenuState } from '../shared/ipc';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { initStorage } from './projects';

let win: BrowserWindow | null = null;
let menuState: MenuState = { projectOpen: false, hasPuml: false, sidebarVisible: true };

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'AutoUML',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  buildMenu(win, menuState);
  win.once('ready-to-show', () => win?.show());

  // Sin ventanas emergentes ni navegación fuera de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    initStorage();
    registerIpc((state) => {
      menuState = state;
      if (win) buildMenu(win, state);
    });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
