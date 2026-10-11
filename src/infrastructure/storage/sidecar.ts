// Sidecar de vista persistida: layout.json del proyecto o <archivo>.autouml.json.
// Módulo puro de main: sin Electron (ni siquiera import type), testeable en Vitest.
import fs from 'node:fs';
import path from 'node:path';
import type { SidecarFilters, SidecarState } from '../../application/ports/ipc';
import { validateViews } from '../../application/deckViews';

/** Versión del esquema del sidecar (migrable en T11). */
export const SIDECAR_VERSION = 1;
/** Nombre del sidecar dentro de la carpeta del proyecto. */
export const SIDECAR_PROJECT_FILE = 'layout.json';
/** Extensión del sidecar para archivos externos. */
const SIDECAR_FILE_SUFFIX = '.autouml.json';

const MAX_COLLAPSED = 10000;
const MAX_OVERRIDES = 100000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

const REL_TYPES: ReadonlySet<string> = new Set(['EXTENDS', 'IMPLEMENTS', 'ASSOCIATION', 'DEPENDENCY', 'COMPOSITION', 'AGGREGATION']);
const VISIBILITIES: ReadonlySet<string> = new Set(['+', '#', '~', '-']);
const MAX_FILTER_ITEMS = 10000;

function stringList(v: unknown, allowed?: ReadonlySet<string>): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((s): s is string => typeof s === 'string' && (!allowed || allowed.has(s))).slice(0, MAX_FILTER_ITEMS);
}

/**
 * Filtros (T8): tolerante. Lo que no se entiende se descarta campo a campo (no invalida el sidecar: la vista
 * y las posiciones valen más que un filtro) y los campos desconocidos no se copian. undefined si no queda nada.
 */
function validateFilters(v: unknown): SidecarFilters | undefined {
  if (!isRecord(v)) return undefined;
  const out: SidecarFilters = {};
  const rels = stringList(v.hiddenRelTypes, REL_TYPES);
  if (rels) out.hiddenRelTypes = rels as NonNullable<SidecarFilters['hiddenRelTypes']>;
  if (typeof v.minVisibility === 'string' && VISIBILITIES.has(v.minVisibility)) {
    out.minVisibility = v.minVisibility as NonNullable<SidecarFilters['minVisibility']>;
  }
  for (const k of ['hideAccessors', 'hideConstructors', 'hideExternal', 'hideUndeclared'] as const) {
    if (typeof v[k] === 'boolean') out[k] = v[k];
  }
  const pkgs = stringList(v.hiddenPackages);
  if (pkgs) out.hiddenPackages = pkgs;
  const types = stringList(v.hiddenTypes);
  if (types) out.hiddenTypes = types;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Ruta del sidecar de un proyecto (junto a diagram.puml). */
export function sidecarPathForProject(projectDir: string): string {
  return path.join(projectDir, SIDECAR_PROJECT_FILE);
}

/** Ruta del sidecar de un archivo externo (cambia la extensión). */
export function sidecarPathForFile(pumlPath: string): string {
  const dir = path.dirname(pumlPath);
  const base = path.basename(pumlPath, path.extname(pumlPath));
  return path.join(dir, `${base}${SIDECAR_FILE_SUFFIX}`);
}

/** Valida un valor desconocido como SidecarState; null si no es válido. */
export function validateSidecar(v: unknown): SidecarState | null {
  if (!isRecord(v)) return null;
  if (v.version !== SIDECAR_VERSION) return null;
  if (!Array.isArray(v.collapsed) || v.collapsed.length > MAX_COLLAPSED) return null;
  if (!v.collapsed.every((id): id is string => typeof id === 'string')) return null;
  if (!isRecord(v.overrides)) return null;
  const entries = Object.entries(v.overrides);
  if (entries.length > MAX_OVERRIDES) return null;
  for (const [, o] of entries) {
    if (!isRecord(o) || !isFiniteNumber(o.dx) || !isFiniteNumber(o.dy)) return null;
  }
  if (v.view !== null) {
    if (!isRecord(v.view)) return null;
    if (!isFiniteNumber(v.view.scale) || v.view.scale <= 0) return null;
    if (!isFiniteNumber(v.view.tx) || !isFiniteNumber(v.view.ty)) return null;
  }
  const filters = validateFilters(v.filters);
  const views = validateViews(v.views, validateFilters);
  return {
    ...(filters ? { filters } : {}),
    ...(views && views.length > 0 ? { views } : {}),
    version: 1,
    collapsed: [...(v.collapsed as string[])],
    overrides: Object.fromEntries(entries.map(([id, o]) => [id, { dx: (o as { dx: number }).dx, dy: (o as { dy: number }).dy }])),
    view: v.view === null
      ? null
      : { scale: (v.view as { scale: number }).scale, tx: (v.view as { tx: number }).tx, ty: (v.view as { ty: number }).ty },
  };
}

/** Lee el sidecar: ausente → null sin corrupto; roto o inválido → null + corrupto. */
export function readSidecarFile(file: string): { state: SidecarState | null; corrupt: boolean } {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { state: null, corrupt: false };
  }
  try {
    const state = validateSidecar(JSON.parse(raw) as unknown);
    return state === null ? { state: null, corrupt: true } : { state, corrupt: false };
  } catch {
    return { state: null, corrupt: true };
  }
}

/** Guarda el sidecar con escritura atómica (tmp+rename); lanza si es inválido. */
export function writeSidecarFile(file: string, state: SidecarState): void {
  const valid = validateSidecar(state);
  if (valid === null) throw new Error('El estado de vista es inválido.');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valid, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
