import { app, BrowserWindow, clipboard, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuAction, MenuCommand, MenuState } from '../../application/ports/ipc';
import { acceleratorOf, type ShortcutId } from '../../application/shortcuts';
import { THEME_MODES, type ThemeMode } from '../../domain/rules/themes';
import { getCurrentProjectName } from '../storage/projects';

let currentLocale: MenuState['locale'] = 'es';

interface MenuCopy {
  file: string;
  edit: string;
  view: string;
  configuration: string;
  help: string;
  newProject: string;
  openProject: string;
  openFile: string;
  home: string;
  loadPuml: string;
  reload: string;
  exportPng: string;
  exportSvg: string;
  exportPdf: string;
  copyPng: string;
  save: string;
  saveAs: string;
  quit: string;
  replacePuml: string;
  copyProjectName: string;
  copy: string;
  selectAll: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  showSidebar: string;
  showEditor: string;
  showInspector: string;
  devTools: string;
  theme: string;
  themes: Record<ThemeMode, string>;
  language: string;
  languageEs: string;
  languageEn: string;
  moreOptions: string;
  about: string;
  aboutDetail: string;
}

const menuCopy: Record<MenuState['locale'], MenuCopy> = {
  es: {
    file: 'Archivo',
    edit: 'Editar',
    view: 'Ver',
    configuration: 'Configuración',
    help: 'Ayuda',
    newProject: 'Nuevo diagrama…',
    openProject: 'Diagramas guardados…',
    openFile: 'Abrir archivo .puml…',
    home: 'Inicio',
    loadPuml: 'Cargar PUML…',
    reload: 'Recargar',
    exportPng: 'Exportar PNG…',
    exportSvg: 'Exportar SVG…',
    exportPdf: 'Exportar PDF…',
    copyPng: 'Copiar PNG',
    save: 'Guardar',
    saveAs: 'Guardar como…',
    quit: 'Salir',
    replacePuml: 'Reemplazar PUML…',
    copyProjectName: 'Copiar nombre del proyecto',
    copy: 'Copiar',
    selectAll: 'Seleccionar todo',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fit: 'Ajustar a pantalla',
    showSidebar: 'Mostrar panel lateral',
    showEditor: 'Editor de código',
    showInspector: 'Inspector',
    devTools: 'Herramientas de desarrollo',
    theme: 'Tema',
    themes: { system: 'Sistema', light: 'Claro', dark: 'Oscuro', contrast: 'Alto contraste' },
    language: 'Idioma',
    languageEs: 'Español',
    languageEn: 'English',
    moreOptions: 'Más opciones…',
    about: 'Acerca de AutoUML',
    aboutDetail: 'Visualizador de diagramas de clases PlantUML — INGSOFT.\nUn proyecto = un archivo .puml.',
  },
  en: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    configuration: 'Settings',
    help: 'Help',
    newProject: 'New diagram…',
    openProject: 'Saved diagrams…',
    openFile: 'Open .puml file…',
    home: 'Home',
    loadPuml: 'Load PUML…',
    reload: 'Reload',
    exportPng: 'Export PNG…',
    exportSvg: 'Export SVG…',
    exportPdf: 'Export PDF…',
    copyPng: 'Copy PNG',
    save: 'Save',
    saveAs: 'Save as…',
    quit: 'Quit',
    replacePuml: 'Replace PUML…',
    copyProjectName: 'Copy project name',
    copy: 'Copy',
    selectAll: 'Select all',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit to screen',
    showSidebar: 'Show side panel',
    showEditor: 'Code editor',
    showInspector: 'Inspector',
    devTools: 'Developer tools',
    theme: 'Theme',
    themes: { system: 'System', light: 'Light', dark: 'Dark', contrast: 'High contrast' },
    language: 'Language',
    languageEs: 'Spanish',
    languageEn: 'English',
    moreOptions: 'More options…',
    about: 'About AutoUML',
    aboutDetail: 'PlantUML class diagram viewer — INGSOFT.\nOne project = one .puml file.',
  },
};

// Acciones que solo main puede ejecutar; las pide el menú dibujado en el renderer (y el menú nativo oculto).
export function runMenuCommand(win: BrowserWindow, command: MenuCommand): void {
  const labels = menuCopy[currentLocale];
  switch (command) {
    case 'quit':
      app.quit();
      break;
    case 'copy':
      win.webContents.copy();
      break;
    case 'select-all':
      win.webContents.selectAll();
      break;
    case 'dev-tools':
      if (!app.isPackaged) win.webContents.toggleDevTools();
      break;
    case 'about':
      void dialog.showMessageBox(win, {
        type: 'info',
        title: labels.about,
        message: `AutoUML ${app.getVersion()}`,
        detail: labels.aboutDetail,
      });
      break;
    case 'copy-project-name': {
      const name = getCurrentProjectName();
      if (name && !win.isDestroyed()) {
        clipboard.writeText(name);
        win.webContents.send('menu:action', 'copy-project-name' satisfies MenuAction);
      }
      break;
    }
  }
}

/** Atajo solo mostrado: lo despacha el renderer (application/shortcuts), así no se ejecuta dos veces. */
const shown = (id: ShortcutId) => ({ accelerator: acceleratorOf(id), registerAccelerator: false });

export function buildMenu(win: BrowserWindow, state: MenuState): void {
  currentLocale = state.locale;
  const labels = menuCopy[state.locale];
  const send = (action: MenuAction) => () => {
    if (!win.isDestroyed()) win.webContents.send('menu:action', action);
  };

  const viewDev: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ type: 'separator' }, { label: labels.devTools, role: 'toggleDevTools' }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: `&${labels.file}`,
      submenu: [
        { label: labels.newProject, ...shown('newProject'), click: send('new-project') },
        { label: labels.openProject, ...shown('openProject'), click: send('open-project') },
        { label: labels.openFile, click: send('open-file') },
        { label: labels.home, click: send('go-home') },
        { type: 'separator' },
        { label: labels.loadPuml, ...shown('loadPuml'), enabled: state.projectOpen, click: send('load-puml') },
        { label: labels.reload, ...shown('reload'), enabled: state.hasPuml, click: send('reload-puml') },
        { label: labels.save, ...shown('save'), enabled: state.hasPuml && state.dirty, click: send('save') },
        { label: labels.saveAs, enabled: state.hasPuml, click: send('save-as') },
        { type: 'separator' },
        // Ctrl+E es del editor de código (T7); exportar PNG queda sin atajo.
        { label: labels.exportPng, enabled: state.hasPuml, click: send('export') },
        { label: labels.exportSvg, ...shown('exportSvg'), enabled: state.hasPuml, click: send('export-svg') },
        { label: labels.exportPdf, ...shown('exportPdf'), enabled: state.hasPuml, click: send('export-pdf') },
        { label: labels.copyPng, ...shown('copyPng'), enabled: state.hasPuml, click: send('copy-png') },
        { type: 'separator' },
        { label: labels.quit, role: 'quit' },
      ],
    },
    {
      label: `&${labels.edit}`,
      submenu: [
        { label: labels.replacePuml, enabled: state.projectOpen, click: send('replace-puml') },
        { label: labels.copyProjectName, enabled: state.projectOpen, click: () => runMenuCommand(win, 'copy-project-name') },
        { type: 'separator' },
        { label: labels.copy, role: 'copy' },
        { label: labels.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: `&${labels.view}`,
      submenu: [
        { label: labels.zoomIn, ...shown('zoomIn'), enabled: state.hasPuml, click: send('zoom-in') },
        { label: labels.zoomOut, ...shown('zoomOut'), enabled: state.hasPuml, click: send('zoom-out') },
        { label: labels.fit, ...shown('fit'), enabled: state.hasPuml, click: send('fit') },
        { type: 'separator' },
        {
          label: labels.showSidebar,
          type: 'checkbox',
          ...shown('toggleSidebar'),
          checked: state.sidebarVisible,
          enabled: state.projectOpen || state.hasPuml,
          click: send('toggle-sidebar'),
        },
        {
          label: labels.showEditor,
          type: 'checkbox',
          ...shown('toggleEditor'),
          checked: state.editorVisible,
          enabled: state.hasPuml,
          click: send('toggle-editor'),
        },
        {
          label: labels.showInspector,
          type: 'checkbox',
          checked: state.inspectorVisible,
          enabled: state.projectOpen || state.hasPuml,
          click: send('toggle-inspector'),
        },
        ...viewDev,
      ],
    },
    {
      label: `&${labels.configuration}`,
      submenu: [
        {
          label: labels.theme,
          submenu: THEME_MODES.map((mode): MenuItemConstructorOptions => ({
            label: labels.themes[mode],
            type: 'radio',
            checked: state.themeMode === mode,
            click: send(`theme-${mode}`),
          })),
        },
        {
          label: labels.language,
          submenu: [
            { label: labels.languageEs, type: 'radio', checked: state.locale === 'es', click: send('locale-es') },
            { label: labels.languageEn, type: 'radio', checked: state.locale === 'en', click: send('locale-en') },
          ],
        },
        { type: 'separator' },
        { label: labels.moreOptions, ...shown('settings'), click: send('settings-more') },
      ],
    },
    {
      label: `&${labels.help}`,
      submenu: [
        { label: labels.about, click: send('show-about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  // La barra nativa se oculta: el renderer dibuja los títulos en su cabecera. Los atajos siguen activos.
  win.setMenuBarVisibility(false);
}
