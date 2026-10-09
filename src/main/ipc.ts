// Manejadores IPC. Todos validan sus argumentos y devuelven Result<T>, nunca lanzan al renderer.
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { MENU_COMMANDS, type LoadOutcome, type MenuCommand, type MenuState, type ProjectInfo, type Result, type SavePumlOutcome } from '../shared/ipc';
import { runMenuCommand } from './menu';
import { isThemeMode } from '../shared/themes';
import { hasPumlExtension, PUML_EXTENSIONS, validatePumlMarkers } from '../shared/validation';
import {
  createProject,
  getCurrentProject,
  getStorage,
  listProjects,
  openProject,
  readProject,
  readPumlText,
  savePuml,
  savePumlText
} from './projects';
import { registerHistoryIpc } from './history';

const MAX_PUML_BYTES = 50 * 1024 * 1024;
const MAX_PNG_BYTES = 100 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(e: unknown): Result<T> {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function asName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Nombre de proyecto inválido.');
  return value;
}

function isMenuState(v: unknown): v is MenuState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return typeof s.projectOpen === 'boolean'
    && typeof s.hasPuml === 'boolean'
    && typeof s.sidebarVisible === 'boolean'
    && (s.locale === 'es' || s.locale === 'en')
    && isThemeMode(s.themeMode);
}

async function messageBox(win: BrowserWindow | null, opts: MessageBoxOptions) {
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

async function showError(win: BrowserWindow | null, message: string, detail?: string): Promise<void> {
  await messageBox(win, { type: 'error', title: 'Error', message, detail, buttons: ['Aceptar'] });
}

async function loadPumlFlow(event: IpcMainInvokeEvent, name: string): Promise<Result<LoadOutcome>> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const project = readProject(name);

  const openOpts: Electron.OpenDialogOptions = {
    title: 'Cargar PUML',
    properties: ['openFile'],
    filters: [
      { name: 'PlantUML', extensions: PUML_EXTENSIONS.map((e) => e.slice(1)) },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  };
  const picked = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts);
  if (picked.canceled || picked.filePaths.length === 0) return ok({ status: 'cancelled' });

  const file = picked.filePaths[0];
  const fileName = path.basename(file);

  if (!hasPumlExtension(fileName)) {
    const msg = `"${fileName}" no es un archivo PlantUML.`;
    await showError(win, msg, `Extensiones permitidas: ${PUML_EXTENSIONS.join(', ')}`);
    return fail(new Error(msg));
  }

  const stat = await fs.promises.stat(file);
  if (stat.size > MAX_PUML_BYTES) {
    const msg = `"${fileName}" es demasiado grande (máximo 50 MB).`;
    await showError(win, msg);
    return fail(new Error(msg));
  }

  const text = await fs.promises.readFile(file, 'utf8');
  const errors = validatePumlMarkers(text);
  if (errors.length > 0) {
    const msg = `"${fileName}" no es un .puml válido. No se copió nada.`;
    await showError(win, msg, errors.join('\n'));
    return fail(new Error(`${msg} ${errors.join(' ')}`));
  }

  // Regla: un solo .puml por proyecto. Si ya existe, hay que confirmar el reemplazo.
  if (project.puml) {
    const answer = await messageBox(win, {
      type: 'warning',
      title: 'Reemplazar PUML',
      message: `El proyecto "${project.meta.name}" ya tiene un .puml (${project.puml.originalFileName}).`,
      detail: `¿Reemplazarlo por "${fileName}"? El archivo anterior se perderá; los diagramas nunca se mezclan.`,
      buttons: ['Reemplazar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (answer.response !== 0) return ok({ status: 'cancelled' });
  }

  return ok({ status: 'loaded', project: savePuml(project.meta.name, file) });
}

export function registerIpc(onMenuState: (state: MenuState) => void): void {
  registerHistoryIpc();
  ipcMain.handle('storage:info', () => getStorage());

  ipcMain.handle('projects:list', () => {
    try {
      return ok(listProjects());
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('projects:create', (_e, name: unknown): Result<ProjectInfo> => {
    try {
      return ok(createProject(asName(name)));
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('projects:open', (_e, name: unknown): Result<ProjectInfo> => {
    try {
      return ok(openProject(asName(name)));
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('projects:current', () => getCurrentProject());

  ipcMain.handle('puml:load', async (e, name: unknown): Promise<Result<LoadOutcome>> => {
    try {
      return await loadPumlFlow(e, asName(name));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('puml:save-to-project', async (event, rawName: unknown, rawSource: unknown): Promise<Result<SavePumlOutcome>> => {
    try {
      const name = asName(rawName);
      if (typeof rawSource !== 'string') throw new Error('El contenido PUML es inválido.');
      const source = rawSource.replace(/^\uFEFF/, '');
      if (Buffer.byteLength(source, 'utf8') > MAX_PUML_BYTES) {
        throw new Error('El archivo supera el límite de 50 MB.');
      }
      const errors = validatePumlMarkers(source);
      if (errors.length > 0) throw new Error(`El .puml no es válido. No se guardó en el proyecto. ${errors.join(' ')}`);
      const project = readProject(name);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (project.puml && readPumlText(name) !== source) {
        const answer = await messageBox(win, {
          type: 'warning',
          title: 'Reemplazar PUML',
          message: `El proyecto "${project.meta.name}" ya tiene un .puml (${project.puml.originalFileName}).`,
          detail: '¿Reemplazarlo por el diagrama actual? El archivo anterior se perderá; los diagramas nunca se mezclan.',
          buttons: ['Reemplazar', 'Cancelar'],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        });
        if (answer.response !== 0) return ok({ status: 'cancelled' });
      }
      return ok({ status: 'saved', project: savePumlText(name, source) });
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('puml:read', (_e, name: unknown): Result<string> => {
    try {
      const text = readPumlText(asName(name));
      return ok(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('puml:reload', (_e, name: unknown): Result<ProjectInfo> => {
    try {
      const n = asName(name);
      const errors = validatePumlMarkers(readPumlText(n));
      if (errors.length > 0) throw new Error(`diagram.puml cambió en disco y ya no es válido: ${errors.join(' ')}`);
      return ok(readProject(n));
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('export:save-png', async (event, fileName: unknown, rawBytes: unknown): Promise<Result<string | null>> => {
    try {
      if (typeof fileName !== 'string' || fileName.trim() === '') throw new Error('Nombre de archivo inválido.');
      if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength < PNG_SIGNATURE.length || rawBytes.byteLength > MAX_PNG_BYTES) {
        throw new Error('La imagen PNG está vacía o supera el límite de 100 MB.');
      }
      const bytes = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
      if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error('Los datos no tienen formato PNG.');

      const safeName = `${path.basename(fileName, path.extname(fileName))}.png`;
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.SaveDialogOptions = {
        title: 'Exportar diagrama como PNG',
        defaultPath: safeName,
        filters: [{ name: 'Imagen PNG', extensions: ['png'] }],
      };
      const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return ok(null);
      await fs.promises.writeFile(picked.filePath, bytes);
      return ok(picked.filePath);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.on('menu:update-state', (_e, state: unknown) => {
    if (isMenuState(state)) onMenuState(state);
  });

  // Los menús se dibujan en el renderer; aquí solo se ejecutan las acciones que requieren main.
  ipcMain.on('menu:command', (e, command: unknown) => {
    if (typeof command !== 'string' || !(MENU_COMMANDS as readonly string[]).includes(command)) return;
    const window = BrowserWindow.fromWebContents(e.sender);
    if (window) runMenuCommand(window, command as MenuCommand);
  });

  ipcMain.on('window:controls-colors', (e, background: unknown, symbols: unknown) => {
    const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    if (!isHex(background) || !isHex(symbols)) return;
    BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({ color: background, symbolColor: symbols, height: 32 });
  });
}
