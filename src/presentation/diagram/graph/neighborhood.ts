// src/presentation/diagram/graph/neighborhood.ts — modo foco: una clase y sus vecinos a N saltos (puro).
// El foco es una transformación del modelo AGUAS ARRIBA del layout (como applyHide): el modelo enfocado
// pasa por la misma caché, el layout estable y la transición de T6. Se aplica sobre el modelo ya agregado,
// así que un paquete plegado es un nodo más: enfocarlo muestra el paquete y sus vecinos a nivel de paquete.
import type { DiagramModel } from '../../../domain/diagram/model';
import { adjacencyOf, type Adjacency } from './adjacency';

export type FocusDirection = 'out' | 'in' | 'both';

export interface FocusSpec {
  id: string;
  /** Saltos, de 1 a 3. */
  depth: number;
  direction: FocusDirection;
}

export const MIN_FOCUS_DEPTH = 1;
export const MAX_FOCUS_DEPTH = 3;

const clampDepth = (d: number): number => Math.min(MAX_FOCUS_DEPTH, Math.max(MIN_FOCUS_DEPTH, Math.round(d) || MIN_FOCUS_DEPTH));

/** BFS limitado a `depth` saltos. null si `id` no es un nodo. O(n + m) en el peor caso. */
export function neighborhood(adj: Adjacency, id: string, depth: number, direction: FocusDirection): Set<string> | null {
  if (!adj.nodes.has(id)) return null;
  const max = clampDepth(depth);
  const seen = new Set<string>([id]);
  let frontier = [id];
  const visit = (next: string[], list: readonly string[] | undefined): void => {
    if (!list) return;
    for (const v of list) {
      if (seen.has(v)) continue;
      seen.add(v);
      next.push(v);
    }
  };
  for (let d = 0; d < max && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const u of frontier) {
      if (direction !== 'in') visit(next, adj.out.get(u));
      if (direction !== 'out') visit(next, adj.in.get(u));
    }
    frontier = next;
  }
  return seen;
}

/** Clave de caché del foco ('' sin foco). */
export function focusKey(spec: FocusSpec | null): string {
  return spec ? `${spec.direction}:${clampDepth(spec.depth)}:${spec.id}` : '';
}

/**
 * Modelo restringido al vecindario de `spec.id`: sus tipos, las relaciones entre ellos, sus paquetes (sin
 * los vacíos) y las notas ancladas a ellos o a sus relaciones. Sin foco, o si el id ya no existe, devuelve
 * el MISMO modelo.
 */
export function applyFocus(model: DiagramModel, spec: FocusSpec | null): DiagramModel {
  if (!spec) return model;
  const keep = neighborhood(adjacencyOf(model), spec.id, spec.depth, spec.direction);
  if (!keep) return model;
  const types = model.types.filter((t) => keep.has(t.id));
  const relationships = [];
  const lines = new Set<number>();
  for (const r of model.relationships) {
    if (!keep.has(r.source) || !keep.has(r.target)) continue;
    lines.add(r.line);
    if (r.associationClass !== undefined && !keep.has(r.associationClass)) {
      const { associationClass: _drop, ...rest } = r;
      relationships.push(rest);
    } else relationships.push(r);
  }
  const packages = [];
  for (const p of model.packages) {
    const typeIds = p.typeIds.filter((id) => keep.has(id));
    if (typeIds.length > 0) packages.push(typeIds.length === p.typeIds.length ? p : { ...p, typeIds });
  }
  const notes = (model.notes ?? []).filter((n) =>
    n.anchor !== undefined ? keep.has(n.anchor) : n.linkLine !== undefined && lines.has(n.linkLine));
  return { ...model, types, relationships, packages, notes };
}
