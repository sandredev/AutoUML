// Puente seguro. Solo importa 'electron' y TIPOS, porque el preload corre en sandbox.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { AutoUmlApi, CloseDecision, IpcChannel, MenuAction, MenuCommand, MenuState, PumlFilesChanged, PumlScope, SidecarState } from '../shared/ipc';
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
  savePumlToProject: (name, source) => invoke('puml:save-to-project', name, source),
  reloadPuml: (name) => invoke('puml:reload', name),
  loadSource: (scope: PumlScope) => invoke('puml:load-source', scope),
  watchPumlFiles: (files: string[]) => invoke('puml:watch', files),
  unwatchPumlFiles: () => {
    ipcRenderer.send('puml:unwatch' as IpcChannel);
  },
  onPumlFilesChanged: (callback: (event: PumlFilesChanged) => void) => {
    const channel: IpcChannel = 'puml:files-changed';
    const listener = (_e: IpcRendererEvent, event: PumlFilesChanged) => callback(event);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  loadSidecar: (scope: PumlScope) => invoke('sidecar:load', scope),
  saveSidecar: (scope: PumlScope, state: SidecarState) => invoke('sidecar:save', scope, state),
  saveSvg: (fileName, svg) => invoke('export:save-svg', fileName, svg),
  savePdf: (fileName, svg, widthPx, heightPx) => invoke('export:save-pdf', fileName, svg, widthPx, heightPx),
  writePngToClipboard: (bytes) => invoke('clipboard:write-png', bytes),
  savePng: (fileName, bytes) => invoke('export:save-png', fileName, bytes),
  updateMenuState: (state: MenuState) => {
    const channel: IpcChannel = 'menu:update-state';
    ipcRenderer.send(channel, state);
  },
  runMenuCommand: (command: MenuCommand) => {
    const channel: IpcChannel = 'menu:command';
    ipcRenderer.send(channel, command);
  },
  setWindowControlsColors: (background: string, symbols: string) => {
    const channel: IpcChannel = 'window:controls-colors';
    ipcRenderer.send(channel, background, symbols);
  },
  onMenuAction: (callback) => {
    const channel: IpcChannel = 'menu:action';
    const listener = (_e: IpcRendererEvent, action: MenuAction) => callback(action);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  onCloseRequested: (callback) => {
    const channel: IpcChannel = 'app:close-requested';
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  confirmClose: (decision: CloseDecision) => {
    if (decision !== 'acknowledged' && decision !== 'close' && decision !== 'cancel') return;
    const channel: IpcChannel = 'app:confirm-close';
    ipcRenderer.send(channel, decision);
  }
};

contextBridge.exposeInMainWorld('autouml', api);
