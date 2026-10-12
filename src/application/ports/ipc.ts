// Tipos compartidos entre main, preload y renderer.
import type { HistoryApi, OpenPumlFile } from './history';
import type { ThemeMode } from '../../domain/rules/themes';
import type { RelType, Visibility } from '../../domain/diagram/model';
// El preload solo importa TIPOS de aquí, porque en modo sandbox no puede cargar otros módulos.

/** Alto de la barra de título unificada (menús + documento + paneles); los controles nativos se superponen. */
export const TITLE_BAR_HEIGHT = 40;

export interface ProjectMeta {
  name: string;
  createdAt: string;
  // Nombre del archivo dentro de la carpeta ("diagram.puml") o null si aún no hay.
  pumlFile: string | null;
  // Nombre original del archivo que cargó el usuario.
  originalFileName: string | null;
  pumlLoadedAt: string | null;
}

export interface PumlInfo {
  fileName: string;
  originalFileName: string;
  lines: number;
  sizeBytes: number;
  loadedAt: string | null;
}

export interface ProjectInfo {
  meta: ProjectMeta;
  dir: string;
  puml: PumlInfo | null;
}

export interface ProjectSummary {
  name: string;
  createdAt: string;
  hasPuml: boolean;
}

/** Información técnica para Configuración › Acerca de (T11). */
export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  /** Sistema operativo legible ("Windows 10.0.26200", "Ubuntu 24.04.1 LTS"). */
  os: string;
  /** Carpeta de datos de la app (proyectos, historial). */
  dataPath: string;
  /** Compilación de desarrollo (no empaquetada). */
  dev: boolean;
}

export interface StorageInfo {
  root: string;
  mode: 'dev' | 'exe' | 'fallback';
  warning: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Vista persistida: sidecar `layout.json` / `<archivo>.autouml.json`. (T5) */
export interface SidecarState {
  version: 1;
  collapsed: string[];
  overrides: Record<string, { dx: number; dy: number }>;
  view: { scale: number; tx: number; ty: number } | null;
  /** Filtros semánticos del visor (T8). Opcional: un sidecar antiguo no lo tiene y sigue siendo v1. */
  filters?: SidecarFilters;
  /** Vistas de presentación (T10). Opcional: sin ellas el sidecar sigue siendo v1. */
  views?: SidecarView[];
  /**
   * Avisos que el usuario decidió no ver en este documento (T11): clave = mensaje del aviso sin el número de
   * línea, así sobrevive a las ediciones. Opcional: sin ellos el sidecar sigue siendo v1.
   */
  ignoredIssues?: string[];
}

/** Una diapositiva del modo presentación (T10): cámara + estado opcional del visor. */
export interface SidecarView {
  title: string;
  view: { scale: number; tx: number; ty: number };
  filters?: SidecarFilters;
  /** id del tipo enfocado al llegar a la vista. */
  focusKey?: string;
  /** Paquetes plegados en esta vista. */
  collapsed?: string[];
  /** Tamaño del lienzo al guardar: la cámara se recentra si se aplica en otro (p. ej. pantalla completa). */
  frame?: { w: number; h: number };
}

/**
 * Filtros del visor por documento (T8). Todo opcional: lo ausente es "sin filtrar", así que un campo
 * nuevo (T11: vistas guardadas…) no rompe sidecars anteriores. Se guarda lo OCULTO, no lo visible: un
 * tipo o paquete que aparezca después se ve por defecto.
 */
export interface SidecarFilters {
  /** Tipos de relación que no se dibujan. */
  hiddenRelTypes?: RelType[];
  /** Visibilidad mínima de los miembros que se muestran ('+' solo públicos … '-' todos). Cambia el tamaño. */
  minVisibility?: Visibility;
  /** Oculta getters/setters (get/set/is + mayúscula). Cambia el tamaño. */
  hideAccessors?: boolean;
  /** Oculta los constructores. Cambia el tamaño. */
  hideConstructors?: boolean;
  /** No dibuja los tipos externos. */
  hideExternal?: boolean;
  /** No dibuja los tipos sin declarar. */
  hideUndeclared?: boolean;
  /** Paquetes desmarcados: sus tipos no se dibujan. */
  hiddenPackages?: string[];
  /** Tipos ocultados uno a uno (menú contextual "Ocultar esta clase"). */
  hiddenTypes?: string[];
}

/** Orden de capas de `layers.json` (T9): null si no hay archivo o no es válido (corrupt lo distingue). */
export interface LayersLoadResult {
  layers: string[] | null;
  corrupt: boolean;
}

export interface SidecarLoadResult {
  state: SidecarState | null;
  /** true si existía pero estaba dañado (usar valores por defecto + aviso). */
  corrupt: boolean;
}

/** De dónde se carga un documento: proyecto o archivo externo (ruta absoluta). (T5) */
export type PumlScope = { project: string } | { file: string };

export interface PumlLineRef {
  file: string;
  line: number;
}

export interface PumlLoadIssue {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface PumlSourceResult {
  /** Ruta absoluta normalizada del archivo de entrada. */
  entryPath: string;
  /** Texto tal cual de la entrada (para guardar). */
  entryText: string;
  /** Texto con los !include expandidos (para parsear). */
  combined: string;
  /** Entrada + incluidos (para vigilar). */
  files: string[];
  /** Origen de cada línea de `combined` (índice = nº de línea − 1). */
  lineMap: PumlLineRef[];
  /** Avisos de la resolución (faltantes, ciclos, profundidad). */
  loadIssues: PumlLoadIssue[];
}

export interface PumlFilesChanged {
  kind: 'changed' | 'removed';
  path: string;
}

export type LoadOutcome =
  | { status: 'loaded'; project: ProjectInfo }
  | { status: 'cancelled' };

export type SavePumlOutcome =
  | { status: 'saved'; project: ProjectInfo }
  | { status: 'cancelled' };

/** Guardado del editor (T7): con proyecto devuelve su info al día (pumlLoadedAt cambia); con archivo externo, null. */
export interface SaveSourceOutcome {
  project: ProjectInfo | null;
}

export type MenuAction =
  | 'new-project'
  | 'open-project'
  | 'load-puml'
  | 'reload-puml'
  | 'replace-puml'
  | 'copy-project-name'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'export'
  | 'export-svg'
  | 'export-pdf'
  | 'copy-png'
  | 'save'
  | 'toggle-sidebar'
  | 'toggle-editor'
  | `theme-${ThemeMode}`
  | 'locale-es'
  | 'locale-en'
  | 'settings-more'
  | 'open-file'
  | 'save-as'
  | 'go-home'
  | 'toggle-inspector'
  | 'show-about';

// Acciones del menú que solo puede ejecutar el proceso main.
export const MENU_COMMANDS = ['quit', 'copy', 'select-all', 'dev-tools', 'about', 'copy-project-name'] as const;
export type MenuCommand = (typeof MENU_COMMANDS)[number];

export interface MenuState {
  projectOpen: boolean;
  hasPuml: boolean;
  sidebarVisible: boolean;
  /** Panel del editor de código visible (T7). */
  editorVisible: boolean;
  /** Panel del inspector visible (T11). */
  inspectorVisible: boolean;
  /** Hay cambios del editor sin guardar (T7). */
  dirty: boolean;
  locale: 'es' | 'en';
  themeMode: ThemeMode;
}

// Respuesta renderer -> main a 'app:close-requested'.
// acknowledged: el renderer recibió la solicitud (detiene el timeout de 2 s).
// close: cerrar la ventana. cancel: mantenerla abierta.
export type CloseDecision = 'acknowledged' | 'close' | 'cancel';

export type IpcChannel =
  | 'history:list'
  | 'history:openPumlFile'
  | 'history:openPumlPath'
  | 'history:openJavaProject'
  | 'history:reopen'
  | 'history:setPinned'
  | 'history:remove'
  | 'history:clear'
  | 'history:savePumlAs'
  | 'storage:info'
  | 'projects:list'
  | 'projects:create'
  | 'projects:open'
  | 'projects:current'
  | 'puml:read'
  | 'puml:load'
  | 'puml:save-to-project'
  | 'puml:reload'
  | 'puml:load-source'
  | 'puml:combine-source'
  | 'puml:save-source'
  | 'puml:watch'
  | 'puml:unwatch'
  | 'puml:files-changed'
  | 'sidecar:load'
  | 'sidecar:save'
  | 'layers:load'
  | 'export:save-png'
  | 'export:save-svg'
  | 'export:save-pdf'
  | 'export:save-markdown'
  | 'clipboard:write-png'
  | 'menu:update-state'
  | 'menu:command'
  | 'window:controls-colors'
  | 'menu:action'
  | 'app:close-requested'
  | 'app:confirm-close'
  | 'history:restore'
  | 'app:info'
  | 'app:open-data-folder';

// API expuesta en window.autouml (bridge tipado del shell Electron).
export interface AutoUmlApi {
  history: HistoryApi;
  // Obtiene y abre el archivo nativo soltado sin exponer su ruta al renderer.
  openDroppedPuml(file: { readonly name: string }): Promise<Result<OpenPumlFile>>;
  getStorageInfo(): Promise<StorageInfo>;
  // Versiones, sistema y carpeta de datos para Acerca de (T11).
  getAppInfo(): Promise<AppInfo>;
  // Abre la carpeta de datos en el explorador del sistema (T11).
  openDataFolder(): Promise<Result<void>>;
  listProjects(): Promise<Result<ProjectSummary[]>>;
  createProject(name: string): Promise<Result<ProjectInfo>>;
  openProject(name: string): Promise<Result<ProjectInfo>>;
  getCurrentProject(): Promise<ProjectInfo | null>;
  // Abre el diálogo nativo, valida, confirma el reemplazo y copia a diagram.puml.
  loadPuml(name: string): Promise<Result<LoadOutcome>>;
  // Guarda el texto actual como diagram.puml dentro del proyecto indicado.
  savePumlToProject(name: string, source: string): Promise<Result<SavePumlOutcome>>;
  // Devuelve el texto de diagram.puml (sin BOM).
  readPuml(name: string): Promise<Result<string>>;
  // Vuelve a leer diagram.puml del disco.
  reloadPuml(name: string): Promise<Result<ProjectInfo>>;
  // Abre el diálogo nativo y guarda la imagen PNG; devuelve null si se cancela.
  savePng(fileName: string, bytes: Uint8Array): Promise<Result<string | null>>;
  // Lee el .puml con sus !include ya resueltos (proyecto o archivo externo). (T5)
  loadSource(scope: PumlScope): Promise<Result<PumlSourceResult>>;
  // Como loadSource, pero con el texto del editor como entrada (sin guardar): parseo en vivo con !include. (T7)
  combineSource(scope: PumlScope, entryText: string): Promise<Result<PumlSourceResult>>;
  // Guarda el texto del editor en el .puml de entrada (proyecto o archivo externo), sin diálogos. (T7)
  saveSource(scope: PumlScope, text: string): Promise<Result<SaveSourceOutcome>>;
  // Vigila los archivos del documento; avisa con onPumlFilesChanged. (T5)
  watchPumlFiles(files: string[]): Promise<Result<{ watched: string[] }>>;
  unwatchPumlFiles(): void;
  onPumlFilesChanged(callback: (event: PumlFilesChanged) => void): () => void;
  loadSidecar(scope: PumlScope): Promise<Result<SidecarLoadResult>>;
  saveSidecar(scope: PumlScope, state: SidecarState): Promise<Result<void>>;
  // Lee layers.json del proyecto o junto al .puml externo (T9).
  loadLayers(scope: PumlScope): Promise<Result<LayersLoadResult>>;
  saveSvg(fileName: string, svg: string): Promise<Result<string | null>>;
  savePdf(fileName: string, svg: string, widthPx: number, heightPx: number): Promise<Result<string | null>>;
  writePngToClipboard(bytes: Uint8Array): Promise<Result<void>>;
  // Abre el diálogo nativo y guarda el informe de arquitectura en Markdown; null si se cancela (T9).
  saveMarkdown(fileName: string, text: string): Promise<Result<string | null>>;
  updateMenuState(state: MenuState): void;
  // Pide a main una acción de menú que el renderer no puede hacer (salir, copiar, diálogo "Acerca de"…).
  runMenuCommand(command: MenuCommand): void;
  // Colorea los botones de minimizar/maximizar/cerrar con el tema activo (#rrggbb).
  setWindowControlsColors(background: string, symbols: string): void;
  // Se suscribe a las acciones del menú nativo. Devuelve la función para cancelar.
  onMenuAction(callback: (action: MenuAction) => void): () => void;
  // Se suscribe a las solicitudes de cierre de la ventana. Devuelve la función para cancelar.
  onCloseRequested(callback: () => void): () => void;
  // Responde a la solicitud de cierre en curso.
  confirmClose(decision: CloseDecision): void;
}
