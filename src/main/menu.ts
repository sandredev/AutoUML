import { app, BrowserWindow, clipboard, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuAction, MenuState } from '../shared/ipc';
import { getCurrentProjectName } from './projects';

interface MenuCopy {
  newProject: string;
  openProject: string;
  loadPuml: string;
  reload: string;
  exportPng: string;
  quit: string;
  replacePuml: string;
  copyProjectName: string;
  copy: string;
  selectAll: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  showSidebar: string;
  devTools: string;
  about: string;
  aboutDetail: string;
}

const menuCopy: Record<MenuState['locale'], MenuCopy> = {
  es: {
    newProject: 'Nuevo proyecto…',
    openProject: 'Abrir proyecto…',
    loadPuml: 'Cargar PUML…',
    reload: 'Recargar',
    exportPng: 'Exportar PNG…',
    quit: 'Salir',
    replacePuml: 'Reemplazar PUML…',
    copyProjectName: 'Copiar nombre del proyecto',
    copy: 'Copiar',
    selectAll: 'Seleccionar todo',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fit: 'Ajustar a pantalla',
    showSidebar: 'Mostrar panel lateral',
    devTools: 'Herramientas de desarrollo',
    about: 'Acerca de AutoUML',
    aboutDetail: 'Visualizador de diagramas de clases PlantUML — INGSOFT.\nUn proyecto = un archivo .puml.',
  },
  en: {
    newProject: 'New project…',
    openProject: 'Open project…',
    loadPuml: 'Load PUML…',
    reload: 'Reload',
    exportPng: 'Export PNG…',
    quit: 'Quit',
    replacePuml: 'Replace PUML…',
    copyProjectName: 'Copy project name',
    copy: 'Copy',
    selectAll: 'Select all',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit to screen',
    showSidebar: 'Show side panel',
    devTools: 'Developer tools',
    about: 'About AutoUML',
    aboutDetail: 'PlantUML class diagram viewer — INGSOFT.\nOne project = one .puml file.',
  },
};

export function buildMenu(win: BrowserWindow, state: MenuState): void {
  const labels = menuCopy[state.locale];
  const send = (action: MenuAction) => () => {
    if (!win.isDestroyed()) win.webContents.send('menu:action', action);
  };

  const viewDev: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ type: 'separator' }, { label: labels.devTools, role: 'toggleDevTools' }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: labels.newProject, accelerator: 'CmdOrCtrl+N', click: send('new-project') },
        { label: labels.openProject, accelerator: 'CmdOrCtrl+Shift+O', click: send('open-project') },
        { type: 'separator' },
        { label: labels.loadPuml, accelerator: 'CmdOrCtrl+O', enabled: state.projectOpen, click: send('load-puml') },
        { label: labels.reload, accelerator: 'CmdOrCtrl+R', enabled: state.hasPuml, click: send('reload-puml') },
        { label: labels.exportPng, accelerator: 'CmdOrCtrl+E', enabled: state.hasPuml, click: send('export') },
        { type: 'separator' },
        { label: labels.quit, role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: labels.replacePuml, enabled: state.projectOpen, click: send('replace-puml') },
        {
          label: labels.copyProjectName,
          enabled: state.projectOpen,
          click: () => {
            const name = getCurrentProjectName();
            if (name) {
              clipboard.writeText(name);
              send('copy-project-name')();
            }
          },
        },
        { type: 'separator' },
        { label: labels.copy, role: 'copy' },
        { label: labels.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: labels.zoomIn, accelerator: 'CmdOrCtrl+=', enabled: state.hasPuml, click: send('zoom-in') },
        { label: labels.zoomOut, accelerator: 'CmdOrCtrl+-', enabled: state.hasPuml, click: send('zoom-out') },
        { label: labels.fit, accelerator: 'CmdOrCtrl+0', enabled: state.hasPuml, click: send('fit') },
        { type: 'separator' },
        {
          label: labels.showSidebar,
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+B',
          checked: state.sidebarVisible,
          enabled: state.projectOpen || state.hasPuml,
          click: send('toggle-sidebar'),
        },
        ...viewDev,
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: labels.about,
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: labels.about,
              message: `AutoUML ${app.getVersion()}`,
              detail: labels.aboutDetail,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
