// src/presentation/diagram/canvas/selection.ts — selección múltiple y marco de selección (puro, sin React).
import type { LayoutResult } from '../types';
import { queryNodes, type SpatialIndex } from './spatial';
import type { Rect } from './viewport';

export const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/** `id` = primaria (Inspector, foco, paleta); `ids` = conjunto completo. Si `id` no es null, está en `ids`. */
export interface Selection {
  id: string | null;
  ids: ReadonlySet<string>;
}

export const single = (id: string | null): Selection => ({ id, ids: id === null ? EMPTY_SELECTION : new Set([id]) });

export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.id !== b.id || a.ids.size !== b.ids.size) return false;
  for (const id of a.ids) if (!b.ids.has(id)) return false;
  return true;
}

/** Rectángulo normalizado entre dos puntos (cualquier dirección de arrastre). */
export function rectBetween(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Ids de las tarjetas que tocan `rect` (coordenadas de mundo), en orden del layout. */
export function nodesInRect(layout: LayoutResult, index: SpatialIndex, rect: Rect): string[] {
  const out: string[] = [];
  for (const i of queryNodes(index, rect)) {
    const n = layout.nodes[i];
    if (n) out.push(n.id);
  }
  return out;
}

/** Tarjetas visibles del paquete `name` y de sus subpaquetes. */
export function packageMemberIds(layout: LayoutResult, name: string): string[] {
  return layout.nodes
    .filter((n) => n.packageName !== undefined && (n.packageName === name || n.packageName.startsWith(name + '.')))
    .map((n) => n.id);
}

/**
 * Ctrl+clic: si todos `ids` ya están seleccionados se quitan; si no, se añaden. La primaria pasa a ser la
 * primera pulsada; al quitar, se conserva la primaria si sigue dentro o pasa a la primera que quede.
 */
export function toggleIn(cur: Selection, ids: readonly string[]): Selection {
  if (ids.length === 0) return cur;
  const next = new Set(cur.ids);
  if (cur.id !== null) next.add(cur.id);
  const allIn = ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allIn) next.delete(id);
    else next.add(id);
  }
  if (!allIn) return { id: ids[0] ?? null, ids: next };
  const id = cur.id !== null && next.has(cur.id) ? cur.id : (next.values().next().value ?? null);
  return { id, ids: next };
}

/**
 * Marco: sustituye la selección por lo que cae dentro o, con Ctrl (`additive`), lo une a `base`.
 * La primaria se conserva si sigue dentro; si no, la primera del marco.
 */
export function marqueeSelection(base: Selection, inRect: readonly string[], additive: boolean): Selection {
  const next = additive ? new Set([...base.ids, ...inRect]) : new Set(inRect);
  const id = base.id !== null && next.has(base.id) ? base.id : (inRect[0] ?? (additive ? base.id : null));
  return { id, ids: next };
}
