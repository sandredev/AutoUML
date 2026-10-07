// Tipos compartidos entre main, preload y renderer.
// El preload solo importa TIPOS de aquí, porque en modo sandbox no puede cargar otros módulos.

export interface ProjectMeta {
  name: string;
  createdAt: string;
  /** Nombre del archivo dentro de la carpeta ("diagram.puml") o null si aún no hay. */
  pumlFile: string | null;
  /** Nombre original del archivo que cargó el usuario. */
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

export type LoadOutcome =
  | { status: 'loaded'; project: ProjectInfo }
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
  | 'toggle-sidebar';

export interface MenuState {
  projectOpen: boolean;
  hasPuml: boolean;
  sidebarVisible: boolean;
}

export type IpcChannel =
  | 'storage:info'
  | 'projects:list'
  | 'projects:create'
  | 'projects:open'
  | 'projects:current'
  | 'puml:read'
  | 'puml:load'
  | 'puml:reload'
  | 'export:save-png'
  | 'menu:update-state'
  | 'menu:action';

/** API expuesta en window.autouml (bridge tipado del shell Electron). */
export interface AutoUmlApi {
  getStorageInfo(): Promise<StorageInfo>;
  listProjects(): Promise<Result<ProjectSummary[]>>;
  createProject(name: string): Promise<Result<ProjectInfo>>;
  openProject(name: string): Promise<Result<ProjectInfo>>;
  getCurrentProject(): Promise<ProjectInfo | null>;
  /** Abre el diálogo nativo, valida, confirma el reemplazo y copia a diagram.puml. */
  loadPuml(name: string): Promise<Result<LoadOutcome>>;
  /** Devuelve el texto de diagram.puml (sin BOM). */
  readPuml(name: string): Promise<Result<string>>;
  /** Vuelve a leer diagram.puml del disco. */
  reloadPuml(name: string): Promise<Result<ProjectInfo>>;
  /** Abre el diálogo nativo y guarda la imagen PNG; devuelve null si se cancela. */
  savePng(fileName: string, bytes: Uint8Array): Promise<Result<string | null>>;
  updateMenuState(state: MenuState): void;
  /** Se suscribe a las acciones del menú nativo. Devuelve la función para cancelar. */
  onMenuAction(callback: (action: MenuAction) => void): () => void;
}
