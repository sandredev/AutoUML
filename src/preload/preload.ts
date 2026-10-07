// Puente seguro. Solo importa 'electron' y TIPOS, porque el preload corre en sandbox.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AutoUmlApi, IpcChannel, MenuAction, MenuState } from '../shared/ipc';

function invoke<T>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api: AutoUmlApi = {
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
