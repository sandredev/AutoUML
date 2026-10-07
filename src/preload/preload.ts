// Puente seguro. Solo importa 'electron' y TIPOS, porque el preload corre en sandbox.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { AutoUmlApi, IpcChannel, MenuAction, MenuState } from '../shared/ipc';
import type { HistoryApi } from '../shared/history';

function invoke<T>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

// Keep channel strings local: sandboxed preload cannot import runtime modules from the app.
const history: HistoryApi = {
  list: () => invoke('history:list'),
  openPumlFile: () => invoke('history:openPumlFile'),
  openPumlPath: (resourcePath) => invoke('history:openPumlPath', resourcePath),
  openJavaProject: () => invoke('history:openJavaProject'),
  reopen: (id) => invoke('history:reopen', id),
  setPinned: (id, pinned) => invoke('history:setPinned', id, pinned),
  remove: (id) => invoke('history:remove', id),
  clear: () => invoke('history:clear'),
  savePumlAs: (source, suggestedName) => invoke('history:savePumlAs', source, suggestedName),
};

const api: AutoUmlApi = {
  history,
  openDroppedPuml: (file) => {
    let resourcePath: string;
    try {
      resourcePath = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]);
    } catch {
      return Promise.resolve({ ok: false, error: 'No se pudo obtener la ruta del archivo soltado.' });
    }
    if (!resourcePath) {
      return Promise.resolve({ ok: false, error: 'No se pudo obtener la ruta del archivo soltado.' });
    }
    return invoke('history:openPumlPath', resourcePath);
  },
  getStorageInfo: () => invoke('storage:info'),
  listProjects: () => invoke('projects:list'),
  createProject: (name) => invoke('projects:create', name),
  openProject: (name) => invoke('projects:open', name),
  getCurrentProject: () => invoke('projects:current'),
  readPuml: (name) => invoke('puml:read', name),
  loadPuml: (name) => invoke('puml:load', name),
  reloadPuml: (name) => invoke('puml:reload', name),
  savePng: (fileName, bytes) => invoke('export:save-png', fileName, bytes),
  updateMenuState: (state: MenuState) => {
    const channel: IpcChannel = 'menu:update-state';
    ipcRenderer.send(channel, state);
  },
  onMenuAction: (callback) => {
    const channel: IpcChannel = 'menu:action';
    const listener = (_e: IpcRendererEvent, action: MenuAction) => callback(action);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
};

contextBridge.exposeInMainWorld('autouml', api);
