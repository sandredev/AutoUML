// Tipos compartidos entre main, preload y renderer.
import type { HistoryApi, OpenPumlFile } from './history';
import type { ThemeMode } from './themes';
// El preload solo importa TIPOS de aquí, porque en modo sandbox no puede cargar otros módulos.

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
  | 'toggle-sidebar'
  | `theme-${ThemeMode}`
  | 'locale-es'
  | 'locale-en'
  | 'settings-more';

// Acciones del menú que solo puede ejecutar el proceso main.
export const MENU_COMMANDS = ['quit', 'copy', 'select-all', 'dev-tools', 'about', 'copy-project-name'] as const;
export type MenuCommand = (typeof MENU_COMMANDS)[number];

export interface MenuState {
  projectOpen: boolean;
  hasPuml: boolean;
  sidebarVisible: boolean;
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
  | 'puml:watch'
  | 'puml:unwatch'
  | 'puml:files-changed'
  | 'sidecar:load'
  | 'sidecar:save'
  | 'export:save-png'
  | 'export:save-svg'
  | 'export:save-pdf'
  | 'clipboard:write-png'
  | 'menu:update-state'
  | 'menu:command'
  | 'window:controls-colors'
  | 'menu:action'
  | 'app:close-requested'
  | 'app:confirm-close';

// API expuesta en window.autouml (bridge tipado del shell Electron).
export interface AutoUmlApi {
  history: HistoryApi;
  // Obtiene y abre el archivo nativo soltado sin exponer su ruta al renderer.
  openDroppedPuml(file: { readonly name: string }): Promise<Result<OpenPumlFile>>;
  getStorageInfo(): Promise<StorageInfo>;
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
  // Vigila los archivos del documento; avisa con onPumlFilesChanged. (T5)
  watchPumlFiles(files: string[]): Promise<Result<{ watched: string[] }>>;
  unwatchPumlFiles(): void;
  onPumlFilesChanged(callback: (event: PumlFilesChanged) => void): () => void;
  loadSidecar(scope: PumlScope): Promise<Result<SidecarLoadResult>>;
  saveSidecar(scope: PumlScope, state: SidecarState): Promise<Result<void>>;
  saveSvg(fileName: string, svg: string): Promise<Result<string | null>>;
  savePdf(fileName: string, svg: string, widthPx: number, heightPx: number): Promise<Result<string | null>>;
  writePngToClipboard(bytes: Uint8Array): Promise<Result<void>>;
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
