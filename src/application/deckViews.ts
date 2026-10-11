// src/application/deckViews.ts — validación tolerante de las vistas de presentación (T10, pura).
// Vive en application porque el sidecar (infrastructure) y el visor (presentation) la comparten.
import type { SidecarFilters, SidecarView } from './ports/ipc';

const MAX_VIEWS = 500;
const MAX_TITLE = 200;
const MAX_COLLAPSED = 10000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateView(v: unknown, filtersOf: (f: unknown) => SidecarFilters | undefined): SidecarView | null {
  if (!isRecord(v) || typeof v.title !== 'string' || !isRecord(v.view)) return null;
  const { scale, tx, ty } = v.view;
  if (!isFiniteNumber(scale) || scale <= 0 || !isFiniteNumber(tx) || !isFiniteNumber(ty)) return null;
  const out: SidecarView = { title: v.title.slice(0, MAX_TITLE), view: { scale, tx, ty } };
  const filters = filtersOf(v.filters);
  if (filters) out.filters = filters;
  if (typeof v.focusKey === 'string') out.focusKey = v.focusKey;
  if (Array.isArray(v.collapsed)) {
    out.collapsed = v.collapsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_COLLAPSED);
  }
  return out;
}

/** Copia superficial de un registro como filtros (sin validar campos): el llamador puede inyectar uno estricto. */
function looseFilters(f: unknown): SidecarFilters | undefined {
  return isRecord(f) ? ({ ...f } as SidecarFilters) : undefined;
}

/** Lista de vistas válidas; undefined si no es un array. */
export function validateViews(
  v: unknown,
  filtersOf: (f: unknown) => SidecarFilters | undefined = looseFilters,
): SidecarView[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SidecarView[] = [];
  for (const item of v.slice(0, MAX_VIEWS)) {
    const view = validateView(item, filtersOf);
    if (view) out.push(view);
  }
  return out;
}
