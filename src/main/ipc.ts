// Manejadores IPC. Todos validan sus argumentos y devuelven Result<T>, nunca lanzan al renderer.
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { MENU_COMMANDS, type LoadOutcome, type MenuCommand, type MenuState, type ProjectInfo, type PumlScope, type PumlSourceResult, type Result, type SavePumlOutcome, type SidecarState } from '../shared/ipc';
import { runMenuCommand } from './menu';
import { isThemeMode } from '../shared/themes';
import { hasPumlExtension, PUML_EXTENSIONS, validatePumlMarkers } from '../shared/validation';
import { loadSourceWithIncludes } from './pumlSource';
import { WatchManager } from './watch';
import { readSidecarFile, sidecarPathForFile, sidecarPathForProject, validateSidecar, writeSidecarFile } from './sidecar';
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
const MAX_SVG_BYTES = 20 * 1024 * 1024;
const MAX_PDF_SIDE_PX = 20000;
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

/** Extensiones que puml:load-source acepta (base del repo más .iuml de includes). */
function isLoadablePuml(fileName: string): boolean {
  return hasPumlExtension(fileName) || fileName.toLowerCase().endsWith('.iuml');
}

/** Valida el scope de carga/sidecar: {project} o {file} con ruta absoluta. */
function asScope(value: unknown): PumlScope {
  if (typeof value !== 'object' || value === null) throw new Error('Destino de carga inválido.');
  const s = value as Record<string, unknown>;
  if (typeof s.project === 'string' && s.project.trim() !== '') return { project: s.project };
  if (typeof s.file === 'string' && s.file.trim() !== '') return { file: path.normalize(s.file) };
  throw new Error('Destino de carga inválido.');
}

/** Resuelve el archivo de entrada del scope (proyecto o externo validado). */
function entryOfScope(scope: PumlScope): string {
  if ('project' in scope) {
    const project = readProject(scope.project);
    if (!project.puml || !project.meta.pumlFile) throw new Error('El proyecto aún no tiene .puml.');
    return path.join(project.dir, project.meta.pumlFile);
  }
  const abs = path.normalize(scope.file);
  if (!path.isAbsolute(abs)) throw new Error('La ruta del archivo debe ser absoluta.');
  if (!isLoadablePuml(path.basename(abs))) {
    throw new Error(`"${path.basename(abs)}" no es un archivo PlantUML.`);
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error('La ruta no es un archivo.');
  if (stat.size > MAX_PUML_BYTES) throw new Error('El archivo supera el límite de 50 MB.');
  return abs;
}

/** Vigilancia única del documento abierto: un watch nuevo reemplaza al anterior. */
const watchManager = new WatchManager();
function stopWatching(): void {
  watchManager.unwatchAll();
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

  // T5: carga con !include resueltos (mismo camino para abrir, recargar y watch).
  ipcMain.handle('puml:load-source', (_e, rawScope: unknown): Result<PumlSourceResult> => {
    try {
      const loaded = loadSourceWithIncludes(entryOfScope(asScope(rawScope)));
      return ok({
        entryPath: loaded.entryPath,
        entryText: loaded.entryText,
        combined: loaded.text,
        files: loaded.files,
        lineMap: loaded.lineMap,
        loadIssues: loaded.issues,
      });
    } catch (e) {
      return fail(e);
    }
  });

  // T5: vigila la entrada + los incluidos; los eventos llegan por 'puml:files-changed'.
  ipcMain.handle('puml:watch', (event, rawFiles: unknown): Result<{ watched: string[] }> => {
    try {
      if (!Array.isArray(rawFiles)) throw new Error('La lista de archivos es inválida.');
      const files: string[] = [];
      for (const f of rawFiles) {
        if (typeof f !== 'string' || f.trim() === '') continue;
        const n = path.normalize(f);
        if (!path.isAbsolute(n)) continue;
        try {
          const st = fs.statSync(n);
          if (!st.isFile() || st.size > MAX_PUML_BYTES) continue;
        } catch {
          continue;
        }
        files.push(n);
      }
      stopWatching();
      const sender = event.sender;
      sender.removeListener('destroyed', stopWatching);
      sender.once('destroyed', stopWatching);
      const { watched } = watchManager.watch(files, (e) => {
        if (!sender.isDestroyed()) sender.send('puml:files-changed', e);
      });
      return ok({ watched });
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.on('puml:unwatch', () => {
    stopWatching();
  });

  // T5: sidecar versionado (layout.json del proyecto o .autouml.json del externo).
  ipcMain.handle('sidecar:load', (_e, rawScope: unknown): Result<{ state: SidecarState | null; corrupt: boolean }> => {
    try {
      const scope = asScope(rawScope);
      const file = 'project' in scope
        ? sidecarPathForProject(readProject(scope.project).dir)
        : sidecarPathForFile(path.normalize(scope.file));
      return ok(readSidecarFile(file));
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('sidecar:save', (_e, rawScope: unknown, rawState: unknown): Result<void> => {
    try {
      const scope = asScope(rawScope);
      const file = 'project' in scope
        ? sidecarPathForProject(readProject(scope.project).dir)
        : sidecarPathForFile(path.normalize(scope.file));
      if (!fs.existsSync(path.dirname(file))) throw new Error('La carpeta del documento no existe.');
      if (validateSidecar(rawState) === null) throw new Error('El estado de vista es inválido.');
      writeSidecarFile(file, rawState as SidecarState);
      return ok(undefined);
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

  // T5: guarda el SVG vectorial (misma plantilla de validación+diálogo+write que el PNG).
  ipcMain.handle('export:save-svg', async (event, fileName: unknown, rawSvg: unknown): Promise<Result<string | null>> => {
    try {
      if (typeof fileName !== 'string' || fileName.trim() === '') throw new Error('Nombre de archivo inválido.');
      if (typeof rawSvg !== 'string' || rawSvg.length === 0 || Buffer.byteLength(rawSvg, 'utf8') > MAX_SVG_BYTES) {
        throw new Error('El SVG está vacío o supera el límite de 20 MB.');
      }
      const safeName = `${path.basename(fileName, path.extname(fileName))}.svg`;
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.SaveDialogOptions = {
        title: 'Exportar diagrama como SVG',
        defaultPath: safeName,
        filters: [{ name: 'Imagen SVG', extensions: ['svg'] }],
      };
      const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return ok(null);
      await fs.promises.writeFile(picked.filePath, rawSvg, 'utf8');
      return ok(picked.filePath);
    } catch (e) {
      return fail(e);
    }
  });

  // T5: PDF vectorial vía ventana oculta con el SVG + printToPDF.
  // A 96 dpi, 1 px = 1/96 pulgadas; la página se crea exactamente del tamaño del SVG.
  ipcMain.handle(
    'export:save-pdf',
    async (event, fileName: unknown, rawSvg: unknown, rawW: unknown, rawH: unknown): Promise<Result<string | null>> => {
      let hidden: BrowserWindow | null = null;
      try {
        if (typeof fileName !== 'string' || fileName.trim() === '') throw new Error('Nombre de archivo inválido.');
        if (typeof rawSvg !== 'string' || rawSvg.length === 0 || Buffer.byteLength(rawSvg, 'utf8') > MAX_SVG_BYTES) {
          throw new Error('El SVG está vacío o supera el límite de 20 MB.');
        }
        if (
          typeof rawW !== 'number' || typeof rawH !== 'number' || !Number.isFinite(rawW) || !Number.isFinite(rawH)
          || rawW < 1 || rawH < 1 || rawW > MAX_PDF_SIDE_PX || rawH > MAX_PDF_SIDE_PX
        ) {
          throw new Error('El tamaño del PDF es inválido.');
        }
        const widthPx = Math.round(rawW);
        const heightPx = Math.round(rawH);
        hidden = new BrowserWindow({
          show: false,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;}svg{display:block;}</style></head><body>${rawSvg}</body></html>`;
        await hidden.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const pdf = await hidden.webContents.printToPDF({
          pageSize: { width: widthPx / 96, height: heightPx / 96 },
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          printBackground: true,
        });
        const safeName = `${path.basename(fileName, path.extname(fileName))}.pdf`;
        const win = BrowserWindow.fromWebContents(event.sender);
        const options: Electron.SaveDialogOptions = {
          title: 'Exportar diagrama como PDF',
          defaultPath: safeName,
          filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
        };
        const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (picked.canceled || !picked.filePath) return ok(null);
        await fs.promises.writeFile(picked.filePath, pdf);
        return ok(picked.filePath);
      } catch (e) {
        return fail(e);
      } finally {
        if (hidden !== null && !hidden.isDestroyed()) hidden.destroy();
      }
    },
  );

  // T5: copiar PNG al portapapeles (Ctrl+Shift+C).
  ipcMain.handle('clipboard:write-png', (_e, rawBytes: unknown): Result<void> => {
    try {
      if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength < PNG_SIGNATURE.length || rawBytes.byteLength > MAX_PNG_BYTES) {
        throw new Error('La imagen PNG está vacía o supera el límite de 100 MB.');
      }
      const bytes = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
      if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error('Los datos no tienen formato PNG.');
      clipboard.writeImage(nativeImage.createFromBuffer(bytes));
      return ok(undefined);
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
