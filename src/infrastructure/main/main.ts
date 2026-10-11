import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { MenuState } from '../../application/ports/ipc';
import { attachCloseFlow, registerCloseFlow } from './closeFlow';
import { registerIpc } from './ipcHandlers';
import { ensureLinuxDesktopEntry } from './linuxDesktop';
import { buildMenu } from './menu';
import { initStorage } from '../storage/projects';

let win: BrowserWindow | null = null;
let menuState: MenuState = {
  projectOpen: false,
  hasPuml: false,
  sidebarVisible: true,
  editorVisible: false,
  dirty: false,
  locale: 'es',
  themeMode: 'system',
};

// En Wayland el compositor deja de pedir fotogramas durante la transición a pantalla completa y el lienzo se
// queda sin repintar hasta la siguiente entrada (#38); bajo XWayland no pasa. El flag solo cuenta en la línea de
// comandos (appendSwitch llega tarde y hasSwitch ya da "wayland"), así que el paquete se relanza con él.
// En desarrollo lo pasa scripts/dev-electron.mjs. AUTOUML_OZONE elige otra plataforma.
// Solo en sesiones Wayland (o si se pidió una plataforma): en X11 puro el valor por defecto ya es x11 y el
// relanzado duplicaría el arranque sin arreglar nada.
const waylandSession = process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY);
const needsOzoneRelaunch =
  process.platform === 'linux'
  && app.isPackaged
  && (waylandSession || Boolean(process.env.AUTOUML_OZONE))
  && !process.argv.some((a) => a.startsWith('--ozone-platform'));
if (needsOzoneRelaunch) {
  app.relaunch({
    execPath: process.env.APPIMAGE || process.execPath,
    args: [...process.argv.slice(1), `--ozone-platform=${process.env.AUTOUML_OZONE || 'x11'}`],
  });
  app.exit(0);
}

const hasSingleInstanceLock = !needsOzoneRelaunch && app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

// Icono de la ventana (issue #2). En dev y empaquetado vive en build/ relativo a la app.
function resolveWindowIcon(): string | undefined {
  const candidate = path.join(__dirname, '../../../build/icon.png');
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
    // Sin barra de título nativa; los controles de ventana quedan como overlay sobre la cabecera.
    titleBarStyle: 'hidden',
    titleBarOverlay: nativeTheme.shouldUseDarkColors
      ? { color: '#1b1c26', symbolColor: '#e6e7ee', height: 32 }
      : { color: '#f4f5f8', symbolColor: '#1e2033', height: 32 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c26' : '#f4f5f8',
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

  // Pantalla completa HTML (#36): Chromium consume Esc para salir antes de que lo vea la página. Mientras
  // dura, Esc se entrega al renderer, que deshace por capas y, al final, sale él mismo de pantalla completa.
  let htmlFullscreen = false;
  win.webContents.on('enter-html-full-screen', () => {
    htmlFullscreen = true;
  });
  win.webContents.on('leave-html-full-screen', () => {
    htmlFullscreen = false;
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (!htmlFullscreen || input.type !== 'keyDown' || input.key !== 'Escape') return;
    event.preventDefault();
    // dispatchEvent devuelve false si algún handler hizo preventDefault (el renderer atendió la tecla). Si no
    // (foco en un campo, diálogo modal, visor desmontado), Esc no puede quedar tragado: se sale de pantalla
    // completa aquí, o el usuario quedaría atrapado (el botón del header queda fuera del elemento).
    void win?.webContents
      .executeJavaScript(
        "(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))",
      )
      .then((notHandled: unknown) => {
        if (notHandled === true && htmlFullscreen) {
          return win?.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()');
        }
        return undefined;
      })
      .catch(() => undefined);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../../../dist/renderer/index.html'));
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
