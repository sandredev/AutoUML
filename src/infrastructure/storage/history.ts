import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import Store from 'electron-store';
import type {
  HistoryEntry,
  HistoryKind,
  HistoryStore,
  OpenPumlFile,
  ReopenHistoryResult,
} from '../../application/ports/history';
import type { Result } from '../../application/ports/ipc';
import { PUML_EXTENSIONS, validatePumlMarkers } from '../../domain/rules/validation';

export const HISTORY_LIMIT = 30;
export const MAX_PUML_BYTES = 5 * 1024 * 1024;
const MAX_ARG_LENGTH = 4096;

interface PersistedEntry {
  id: string;
  kind: HistoryKind;
  path: string;
  name: string;
  lastOpenedAt: string;
  pinned: boolean;
}

export interface HistoryBackend {
  read(): unknown;
  write(entries: PersistedEntry[]): void;
}

type ExistsProbe = (kind: HistoryKind, resourcePath: string) => Promise<boolean>;

interface HistoryStoreOptions {
  platform?: NodeJS.Platform;
  now?: () => Date;
  exists?: ExistsProbe;
  limit?: number;
}

class HistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryError';
  }
}

export function normalizeHistoryPath(resourcePath: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let normalized = pathApi.normalize(pathApi.resolve(resourcePath));
  const root = pathApi.parse(normalized).root;
  while (normalized.length > root.length && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function pathKey(resourcePath: string, platform: NodeJS.Platform): string {
  const normalized = normalizeHistoryPath(resourcePath, platform);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function entryId(kind: HistoryKind, resourcePath: string, platform: NodeJS.Platform): string {
  return createHash('sha1').update(`${kind}\u0000${pathKey(resourcePath, platform)}`).digest('hex');
}

const fileExists: ExistsProbe = async (kind, resourcePath) => {
  try {
    const stat = await fs.stat(resourcePath);
    return kind === 'java' ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
};

function timestamp(entry: PersistedEntry): number {
  const parsed = Date.parse(entry.lastOpenedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEntries(entries: PersistedEntry[]): PersistedEntry[] {
  return [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || timestamp(b) - timestamp(a));
}

function trimEntries(entries: PersistedEntry[], limit: number): PersistedEntry[] {
  const kept = [...entries];
  while (kept.length > limit) {
    const unpinned = kept.filter((entry) => !entry.pinned);
    const candidates = unpinned.length ? unpinned : kept;
    const oldest = candidates.reduce((a, b) => timestamp(a) <= timestamp(b) ? a : b);
    kept.splice(kept.indexOf(oldest), 1);
  }
  return kept;
}

function isPersistedEntry(value: unknown): value is PersistedEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && (entry.kind === 'puml' || entry.kind === 'java') &&
    typeof entry.path === 'string' && typeof entry.name === 'string' &&
    typeof entry.lastOpenedAt === 'string' && typeof entry.pinned === 'boolean';
}

export function createHistoryStore(backend: HistoryBackend, options: HistoryStoreOptions = {}): HistoryStore {
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());
  const exists = options.exists ?? fileExists;
  const limit = options.limit ?? HISTORY_LIMIT;

  const load = (): PersistedEntry[] => {
    const raw = backend.read();
    return Array.isArray(raw) ? raw.filter(isPersistedEntry) : [];
  };
  const save = (entries: PersistedEntry[]): PersistedEntry[] => {
    const sorted = sortEntries(trimEntries(entries, limit));
    backend.write(sorted);
    return sorted;
  };
  const publicEntries = async (entries: PersistedEntry[]): Promise<HistoryEntry[]> =>
    Promise.all(entries.map(async (entry) => ({ ...entry, available: await exists(entry.kind, entry.path) })));

  return {
    async list() {
      return publicEntries(sortEntries(load()));
    },
    async record(kind, resourcePath, name) {
      const normalized = normalizeHistoryPath(resourcePath, platform);
      const id = entryId(kind, normalized, platform);
      const entries = load();
      const previous = entries.find((entry) => entry.id === id);
      const next: PersistedEntry = {
        id,
        kind,
        path: normalized,
        name: name.trim() || path.basename(normalized),
        lastOpenedAt: now().toISOString(),
        pinned: previous?.pinned ?? false,
      };
      return publicEntries(save([...entries.filter((entry) => entry.id !== id), next]));
    },
    async setPinned(id, pinned) {
      const entries = load();
      if (!entries.some((entry) => entry.id === id)) throw new HistoryError('La entrada del historial no existe.');
      return publicEntries(save(entries.map((entry) => entry.id === id ? { ...entry, pinned } : entry)));
    },
    async remove(id) {
      return publicEntries(save(load().filter((entry) => entry.id !== id)));
    },
    async clear() {
      backend.write([]);
    },
  };
}

function createElectronBackend(): HistoryBackend {
  const store = new Store<{ history: PersistedEntry[] }>({ name: 'autouml', defaults: { history: [] } });
  return {
    read: () => store.get('history', []),
    write: (entries) => store.set('history', entries),
  };
}

function hasPumlExtension(filePath: string): boolean {
  return (PUML_EXTENSIONS as readonly string[]).includes(path.extname(filePath).toLowerCase());
}

function decodePuml(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_PUML_BYTES) {
    throw new HistoryError(`El archivo supera el límite de 5 MB (${(bytes.byteLength / 1048576).toFixed(1)} MB).`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HistoryError('El archivo no es texto UTF-8 válido.');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const errors = validatePumlMarkers(text);
  if (errors.length) throw new HistoryError(errors.join(' '));
  return text;
}

async function readPumlFile(filePath: string): Promise<string> {
  if (!hasPumlExtension(filePath)) throw new HistoryError(`Extensión no permitida. Usa: ${PUML_EXTENSIONS.join(', ')}.`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new HistoryError('El archivo no existe o no es un archivo regular.');
  if (stat.size > MAX_PUML_BYTES) {
    throw new HistoryError(`El archivo supera el límite de 5 MB (${(stat.size / 1048576).toFixed(1)} MB).`);
  }
  return decodePuml(await fs.readFile(filePath));
}

async function openPumlAt(store: HistoryStore, filePath: string): Promise<OpenPumlFile> {
  const normalized = normalizeHistoryPath(filePath);
  const source = await readPumlFile(normalized);
  const entries = await store.record('puml', normalized, path.basename(normalized));
  const entry = entries.find((candidate) => candidate.id === entryId('puml', normalized, process.platform));
  if (!entry) throw new HistoryError('No se pudo registrar el archivo en el historial.');
  return { entry, source };
}

async function reopenEntry(store: HistoryStore, id: string): Promise<ReopenHistoryResult> {
  const entry = (await store.list()).find((candidate) => candidate.id === id);
  if (!entry) throw new HistoryError('La entrada del historial no existe.');
  if (!entry.available) return { kind: 'missing', entry };
  if (entry.kind === 'java') {
    const entries = await store.record('java', entry.path, entry.name);
    return { kind: 'java', entry: entries.find((candidate) => candidate.id === id) ?? entry, projectPath: entry.path };
  }
  const opened = await openPumlAt(store, entry.path);
  return { kind: 'puml', ...opened };
}

function argumentString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ARG_LENGTH || value.includes('\u0000')) {
    throw new HistoryError(`Argumento inválido: ${label}.`);
  }
  return value;
}

function safeFileName(suggestedName: string): string {
  const base = path.basename(suggestedName.replace(/\\/g, '/')).replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  return `${base.replace(/\.[^.]*$/, '') || 'diagrama'}.puml`;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(error: unknown): Result<T> {
  return { ok: false, error: error instanceof Error ? error.message : 'Error desconocido.' };
}

async function guard<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    return fail(error);
  }
}

async function showOpen(options: OpenDialogOptions) {
  const window = BrowserWindow.getFocusedWindow();
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

async function showSave(options: SaveDialogOptions) {
  const window = BrowserWindow.getFocusedWindow();
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

export function registerHistoryIpc(store: HistoryStore = createHistoryStore(createElectronBackend())): void {
  const extensions = PUML_EXTENSIONS.map((extension) => extension.slice(1));
  ipcMain.handle('history:list', () => guard(() => store.list()));
  ipcMain.handle('history:openPumlFile', () => guard(async () => {
    const result = await showOpen({ properties: ['openFile'], filters: [{ name: 'PlantUML', extensions }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return openPumlAt(store, result.filePaths[0]);
  }));
  ipcMain.handle('history:openPumlPath', (_event, rawPath: unknown) => guard(async () => {
    const filePath = argumentString(rawPath, 'resourcePath');
    if (!path.isAbsolute(filePath)) throw new HistoryError('La ruta debe ser absoluta.');
    return openPumlAt(store, filePath);
  }));
  ipcMain.handle('history:openJavaProject', () => guard(async () => {
    const result = await showOpen({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const dir = normalizeHistoryPath(result.filePaths[0]);
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) throw new HistoryError('La ruta seleccionada no es una carpeta.');
    const entries = await store.record('java', dir, path.basename(dir));
    return entries.find((entry) => entry.id === entryId('java', dir, process.platform)) ?? null;
  }));
  ipcMain.handle('history:reopen', (_event, id: unknown) => guard(() => reopenEntry(store, argumentString(id, 'id'))));
  ipcMain.handle('history:setPinned', (_event, id: unknown, pinned: unknown) => guard(() => {
    if (typeof pinned !== 'boolean') throw new HistoryError('Argumento inválido: pinned.');
    return store.setPinned(argumentString(id, 'id'), pinned);
  }));
  ipcMain.handle('history:remove', (_event, id: unknown) => guard(() => store.remove(argumentString(id, 'id'))));
  ipcMain.handle('history:clear', () => guard(async () => { await store.clear(); }));
  ipcMain.handle('history:savePumlAs', (_event, source: unknown, suggestedName: unknown) => guard(async () => {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_PUML_BYTES) {
      throw new HistoryError('El contenido es inválido o supera el límite de 5 MB.');
    }
    const name = safeFileName(typeof suggestedName === 'string' ? suggestedName : 'diagrama');
    const result = await showSave({ defaultPath: name, filters: [{ name: 'PlantUML', extensions: ['puml'] }] });
    if (result.canceled || !result.filePath) return null;
    const target = path.extname(result.filePath).toLowerCase() === '.puml' ? result.filePath : `${result.filePath}.puml`;
    const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
    await fs.writeFile(target, text, 'utf8');
    return target;
  }));
}
