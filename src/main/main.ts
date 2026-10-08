import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { MenuState } from '../shared/ipc';
import { attachCloseFlow, registerCloseFlow } from './closeFlow';
import { registerIpc } from './ipc';
import { ensureLinuxDesktopEntry } from './linuxDesktop';
import { buildMenu } from './menu';
import { initStorage } from './projects';

let win: BrowserWindow | null = null;
let menuState: MenuState = { projectOpen: false, hasPuml: false, sidebarVisible: true, locale: 'es' };

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

// Icono de la ventana (issue #2). En dev y empaquetado vive en build/ relativo a la app.
function resolveWindowIcon(): string | undefined {
  const candidate = path.join(__dirname, '../../build/icon.png');
  try {
    return fs.existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'AutoUML',
    icon: resolveWindowIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  buildMenu(win, menuState);
  attachCloseFlow(win);
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
    ensureLinuxDesktopEntry();
    initStorage();
    registerCloseFlow();
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
