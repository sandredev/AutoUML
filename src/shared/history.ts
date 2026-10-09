import type { Result } from './ipc';

/** Tipo de recurso que puede reaparecer desde el historial de AutoUML. */
export type HistoryKind = 'puml' | 'java';

/** Entrada pública del historial. `available` se calcula al leerlo, no se persiste. */
export interface HistoryEntry {
  /** Clave estable para el par kind + ruta normalizada. */
  id: string;
  kind: HistoryKind;
  path: string;
  name: string;
  lastOpenedAt: string;
  pinned: boolean;
  available: boolean;
}

export interface OpenPumlFile {
  entry: HistoryEntry;
  source: string;
}

export type ReopenHistoryResult =
  | { kind: 'puml'; entry: HistoryEntry; source: string }
  | { kind: 'java'; entry: HistoryEntry; projectPath: string }
  | { kind: 'missing'; entry: HistoryEntry };

/**
 * IPC contract for the persistent recent-resource history.
 * File access and path checks stay in Electron main; preload exposes only these operations.
 */
export interface HistoryApi {
  list(): Promise<Result<HistoryEntry[]>>;
  openPumlFile(): Promise<Result<OpenPumlFile | null>>;
  openPumlPath(resourcePath: string): Promise<Result<OpenPumlFile>>;
  openJavaProject(): Promise<Result<HistoryEntry | null>>;
  reopen(id: string): Promise<Result<ReopenHistoryResult>>;
  setPinned(id: string, pinned: boolean): Promise<Result<HistoryEntry[]>>;
  remove(id: string): Promise<Result<HistoryEntry[]>>;
  clear(): Promise<Result<void>>;
  savePumlAs(source: string, suggestedName: string): Promise<Result<string | null>>;
}

/**
 * Store contract: upsert on normalized kind + path, cap the list at 30 entries,
 * sort pinned entries first then by lastOpenedAt desc, trim oldest unpinned entries first,
 * and never delete user files. If all entries are pinned, trim the oldest pinned entry.
 */
export interface HistoryStore {
  list(): Promise<HistoryEntry[]>;
  record(kind: HistoryKind, resourcePath: string, name: string): Promise<HistoryEntry[]>;
  setPinned(id: string, pinned: boolean): Promise<HistoryEntry[]>;
  remove(id: string): Promise<HistoryEntry[]>;
  clear(): Promise<void>;
}
