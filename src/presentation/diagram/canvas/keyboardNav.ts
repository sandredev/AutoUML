// src/presentation/diagram/canvas/keyboardNav.ts — atajos de teclado del canvas (T10.6, puro).
import type { RelationshipModel, RelType } from '../../../domain/diagram/model';
import type { NodeBox } from '../types';

export type SpatialDir = 'left' | 'right' | 'up' | 'down';
export type ShortcutAction = SpatialDir | 'zoomIn' | 'zoomOut' | 'fit' | 'help';

const KEYS: Readonly<Record<string, ShortcutAction>> = {
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowUp: 'up',
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  '_': 'zoomOut',
  '0': 'fit',
  '?': 'help',
};

/** Acción de una tecla; null si no es atajo o lleva Ctrl/Alt/Meta (no pisa los del navegador). */
export function shortcutOf(key: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}): ShortcutAction | null {
  if (mods.ctrl || mods.alt || mods.meta) return null;
  return KEYS[key] ?? null;
}

/**
 * Hover que debe quedar tras moverse con teclado a `target`: el puntero no se mueve, así que un hover
 * sobre otra clase (o relación) se queda pegado; solo se conserva el que ya apunta al destino.
 */
export function hoverAfterKeyNav<H extends { kind: string; id?: string } | null>(hover: H, target: string): H | null {
  return hover !== null && hover.kind === 'node' && hover.id === target ? hover : null;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const AXIS: Readonly<Record<SpatialDir, readonly [number, number]>> = {
  right: [1, 0],
  left: [-1, 0],
  down: [0, 1],
  up: [0, -1],
};

/**
 * Coste de ir de `a` a `b` en `dir` (entre centros): avance + 2 × desvío lateral; null si `b` queda
 * fuera del cono de 45° de la flecha.
 */
function spatialCost(a: NodeBox, b: NodeBox, dir: SpatialDir): number | null {
  const [ux, uy] = AXIS[dir];
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const along = dx * ux + dy * uy;
  const side = Math.abs(dx * uy - dy * ux);
  return along > 0 && side <= along ? along + 2 * side : null;
}

/** Clase de `candidates` más cercana a `from` en `dir` (empate: menor id), o null. */
function nearestIn(from: NodeBox, candidates: Iterable<NodeBox>, dir: SpatialDir): string | null {
  let best: string | null = null;
  let bestCost = Infinity;
  for (const b of candidates) {
    const cost = b.id === from.id ? null : spatialCost(from, b, dir);
    if (cost !== null && (cost < bestCost || (cost === bestCost && best !== null && byId(b.id, best) < 0))) {
      best = b.id;
      bestCost = cost;
    }
  }
  return best;
}

/** Primera clase visible por id (punto de partida sin selección), o null. */
const firstById = (boxes: readonly NodeBox[]): string | null => boxes.map((b) => b.id).sort(byId)[0] ?? null;

/**
 * Flechas: clase visible (`boxes`) más cercana a `from` en `dir`, tenga o no relaciones, así que se llega a
 * cualquier caja. null si no hay nada en esa dirección. Sin `from` (o fuera de `boxes`): la primera por id.
 */
export function spatialNext(boxes: readonly NodeBox[], from: string | null, dir: SpatialDir): string | null {
  const origin = from === null ? undefined : boxes.find((b) => b.id === from);
  if (origin === undefined) return firstById(boxes);
  return nearestIn(origin, boxes, dir);
}

/** Arista mínima que necesita el recorrido de relaciones (subconjunto de `EdgePath`). */
export interface FlowEdge {
  source: string;
  target: string;
  type: RelType;
  label?: string;
}

/** Paso del flujo de una relación: una entidad o su comentario. */
export type FlowStep = { kind: 'node'; id: string } | { kind: 'label'; text: string };

/**
 * Flujo de una relación: entidad padre, comentario (si lo tiene) y entidad hija. En EXTENDS/IMPLEMENTS el
 * padre es `target`; en el resto, `source` (el todo, el que depende o el que origina la asociación).
 */
export function relationFlow(edge: FlowEdge): FlowStep[] {
  const upward = edge.type === 'EXTENDS' || edge.type === 'IMPLEMENTS';
  const parent = upward ? edge.target : edge.source;
  const child = upward ? edge.source : edge.target;
  const text = edge.label?.trim();
  return [
    { kind: 'node', id: parent },
    ...(text ? [{ kind: 'label' as const, text }] : []),
    { kind: 'node', id: child },
  ];
}

/** Relación de una clase con la posición (centro) de la clase del otro extremo. */
export interface RelationSlot {
  index: number;
  x: number;
  y: number;
}

/**
 * Relaciones de `id` (bucles y otros extremos no visibles fuera) en orden de recorrido: primero las de
 * arriba (otra clase por encima del centro de `id`) y luego las de abajo, cada fila de izquierda a derecha.
 */
export function relationOrder(edges: readonly FlowEdge[], boxes: readonly NodeBox[], id: string): RelationSlot[] {
  const center = new Map(boxes.map((b) => [b.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }]));
  const origin = center.get(id);
  if (origin === undefined) return [];
  const slots: RelationSlot[] = [];
  edges.forEach((e, index) => {
    if (e.source === e.target || (e.source !== id && e.target !== id)) return;
    const at = center.get(e.source === id ? e.target : e.source);
    if (at !== undefined) slots.push({ index, x: at.x, y: at.y });
  });
  const above = (s: RelationSlot): number => (s.y < origin.y ? 0 : 1);
  return slots.sort((a, b) => above(a) - above(b) || a.x - b.x || a.y - b.y || a.index - b.index);
}

/**
 * Mayús + flechas: elige otra relación de `order`. ←/→ recorren ese orden (cíclico): → hacia la derecha y,
 * al acabarse las de arriba, las de abajo; ← al revés. ↑/↓ saltan a la relación más cercana por encima o
 * por debajo de `cur` (null si no hay). Sin `cur` válido: →/↓ la primera y ←/↑ la última.
 */
export function pickEdge(order: readonly RelationSlot[], cur: number | null, dir: SpatialDir): number | null {
  if (order.length === 0) return null;
  const forward = dir === 'right' || dir === 'down';
  const i = cur === null ? -1 : order.findIndex((s) => s.index === cur);
  if (i < 0) return (forward ? order[0] : order[order.length - 1]).index;
  if (dir === 'left' || dir === 'right') return order[(i + (forward ? 1 : order.length - 1)) % order.length].index;
  const from = order[i];
  let best: number | null = null;
  let bestCost = Infinity;
  for (const s of order) {
    const dy = forward ? s.y - from.y : from.y - s.y;
    if (s === from || dy <= 0) continue;
    const cost = dy + 2 * Math.abs(s.x - from.x);
    if (cost < bestCost) {
      best = s.index;
      bestCost = cost;
    }
  }
  return best;
}

/** Flechas con una relación elegida: →/↓ avanza un paso del flujo, ←/↑ retrocede; sin salirse (no cicla). */
export function stepAlong(count: number, step: number, dir: SpatialDir): number {
  const forward = dir === 'right' || dir === 'down';
  return Math.min(count - 1, Math.max(0, step + (forward ? 1 : -1)));
}

/**
 * Flechas en modo relaciones: la vecina visible de `from` por relaciones de tipo `type` (null = cualquiera)
 * más cercana en `dir`; si no hay, la primera (→/↓) o última (←/↑) por id. null sin vecinas. Sin `from`
 * (o fuera de `boxes`): la primera clase visible por id.
 */
export function relatedNext(
  boxes: readonly NodeBox[],
  rels: readonly RelationshipModel[],
  from: string | null,
  type: RelType | null,
  dir: SpatialDir,
): string | null {
  const origin = from === null ? undefined : boxes.find((b) => b.id === from);
  if (origin === undefined) return firstById(boxes);
  const linked = new Set<string>();
  for (const r of rels) {
    if (type !== null && r.type !== type) continue;
    if (r.source === origin.id) linked.add(r.target);
    else if (r.target === origin.id) linked.add(r.source);
  }
  const neighbors = boxes.filter((b) => linked.has(b.id) && b.id !== origin.id);
  const spatial = nearestIn(origin, neighbors, dir);
  if (spatial !== null) return spatial;
  const ids = neighbors.map((b) => b.id).sort(byId);
  return (dir === 'right' || dir === 'down' ? ids[0] : ids[ids.length - 1]) ?? null;
}
