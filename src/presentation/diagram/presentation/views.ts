// src/presentation/diagram/presentation/views.ts — vistas del modo presentación (T10, puro).
// Validación tolerante: una vista rota se descarta sin tumbar las demás, y un opcional malo se
// descarta campo a campo. Solo depende de tipos de application: main también lo usa (sidecar).
import type { SidecarFilters, SidecarView } from '../../../application/ports/ipc';

export type DeckView = SidecarView;

const MAX_VIEWS = 500;
const MAX_TITLE = 200;
const MAX_COLLAPSED = 10000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateView(v: unknown, filtersOf: (f: unknown) => SidecarFilters | undefined): DeckView | null {
  if (!isRecord(v) || typeof v.title !== 'string' || !isRecord(v.view)) return null;
  const { scale, tx, ty } = v.view;
  if (!isFiniteNumber(scale) || scale <= 0 || !isFiniteNumber(tx) || !isFiniteNumber(ty)) return null;
  const out: DeckView = { title: v.title.slice(0, MAX_TITLE), view: { scale, tx, ty } };
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
): DeckView[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: DeckView[] = [];
  for (const item of v.slice(0, MAX_VIEWS)) {
    const view = validateView(item, filtersOf);
    if (view) out.push(view);
  }
  return out;
}

/** Forma JSON estable: sin campos undefined ni referencias compartidas. */
export function serializeViews(views: readonly DeckView[]): DeckView[] {
  return views.map((d) => {
    const out: DeckView = { title: d.title, view: { scale: d.view.scale, tx: d.view.tx, ty: d.view.ty } };
    if (d.filters !== undefined) out.filters = structuredClone(d.filters);
    if (d.focusKey !== undefined) out.focusKey = d.focusKey;
    if (d.collapsed !== undefined) out.collapsed = [...d.collapsed];
    return out;
  });
}

export function addView(views: readonly DeckView[], view: DeckView): DeckView[] {
  return [...views, view];
}

export function removeView(views: readonly DeckView[], index: number): DeckView[] {
  return views.filter((_, i) => i !== index);
}

export function renameView(views: readonly DeckView[], index: number, title: string): DeckView[] {
  return views.map((v, i) => (i === index ? { ...v, title: title.slice(0, MAX_TITLE) } : v));
}

/** Mueve la vista `from` a la posición `to` (acotada a la lista). */
export function moveView(views: readonly DeckView[], from: number, to: number): DeckView[] {
  if (from < 0 || from >= views.length) return [...views];
  const out = [...views];
  const [v] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, v);
  return out;
}

/** Índice tras pulsar ←/→ (sin dar la vuelta); -1 si no hay vistas. */
export function stepView(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  return Math.max(0, Math.min(count - 1, index + dir));
}
