// Menú nativo: aporta atajos globales a la ventana, estilo del sistema y menos código.
import { app, BrowserWindow, clipboard, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuAction, MenuState } from '../shared/ipc';
import { getCurrentProjectName } from './projects';

export function buildMenu(win: BrowserWindow, state: MenuState): void {
  const send = (action: MenuAction) => () => {
    if (!win.isDestroyed()) win.webContents.send('menu:action', action);
  };

  const viewDev: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ type: 'separator' }, { label: 'Herramientas de desarrollo', role: 'toggleDevTools' }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'Nuevo proyecto…', accelerator: 'CmdOrCtrl+N', click: send('new-project') },
        { label: 'Abrir proyecto…', accelerator: 'CmdOrCtrl+Shift+O', click: send('open-project') },
        { type: 'separator' },
        { label: 'Cargar PUML…', accelerator: 'CmdOrCtrl+O', enabled: state.projectOpen, click: send('load-puml') },
        { label: 'Recargar', accelerator: 'CmdOrCtrl+R', enabled: state.hasPuml, click: send('reload-puml') },
        { label: 'Exportar PNG…', accelerator: 'CmdOrCtrl+E', enabled: state.hasPuml, click: send('export') },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Reemplazar PUML…', enabled: state.projectOpen, click: send('replace-puml') },
        {
          label: 'Copiar nombre del proyecto',
          enabled: state.projectOpen,
          click: () => {
            const name = getCurrentProjectName();
            if (name) {
              clipboard.writeText(name);
              send('copy-project-name')();
            }
          }
        },
        { type: 'separator' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Seleccionar todo', role: 'selectAll' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Zoom +', accelerator: 'CmdOrCtrl+=', enabled: state.hasPuml, click: send('zoom-in') },
        { label: 'Zoom −', accelerator: 'CmdOrCtrl+-', enabled: state.hasPuml, click: send('zoom-out') },
        { label: 'Ajustar a pantalla', accelerator: 'CmdOrCtrl+0', enabled: state.hasPuml, click: send('fit') },
        { type: 'separator' },
        {
          label: 'Mostrar sidebar',
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+B',
          checked: state.sidebarVisible,
          enabled: state.projectOpen || state.hasPuml,
          click: send('toggle-sidebar')
        },
        ...viewDev
      ]
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Acerca de AutoUML',
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: 'Acerca de',
              message: `AutoUML ${app.getVersion()}`,
              detail: 'Visualizador de diagramas de clases PlantUML — INGSOFT.\nUn proyecto = un archivo .puml.'
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
