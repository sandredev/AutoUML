// src/render/canvas/edgePath.ts — geometría de aristas para el dibujo (puro, sin DOM).
import type { HeadType, RelationshipModel } from '../../core/model';

/** Radio por defecto de las esquinas de una arista ortogonal (unidades de mundo). */
export const CORNER_RADIUS = 5;
const EPS = 0.01;

/** Orden de dibujo: mover, línea recta o arco de esquina (equivalente a CanvasRenderingContext2D.arcTo). */
export type PathOp =
  | { op: 'move'; x: number; y: number }
  | { op: 'line'; x: number; y: number }
  | { op: 'arc'; x1: number; y1: number; x2: number; y2: number; r: number };

/** Quita puntos repetidos y puntos intermedios colineales. Con menos de 2 puntos válidos devuelve la entrada. */
export function simplify(points: readonly number[]): number[] {
  const n = Math.floor(points.length / 2);
  if (n < 2) return points.slice(0, n * 2);
  const out: number[] = [points[0] ?? 0, points[1] ?? 0];
  for (let i = 1; i < n; i++) {
    const x = points[i * 2] ?? 0;
    const y = points[i * 2 + 1] ?? 0;
    const m = out.length;
    const lx = out[m - 2] ?? 0;
    const ly = out[m - 1] ?? 0;
    if (Math.abs(x - lx) < EPS && Math.abs(y - ly) < EPS) continue; // repetido
    if (m >= 4) {
      const px = out[m - 4] ?? 0;
      const py = out[m - 3] ?? 0;
      // Colineal si el producto cruzado es ~0 y el punto sigue en la misma dirección.
      const cross = (lx - px) * (y - ly) - (ly - py) * (x - lx);
      const dot = (lx - px) * (x - lx) + (ly - py) * (y - ly);
      if (Math.abs(cross) < EPS && dot >= 0) {
        out[m - 2] = x;
        out[m - 1] = y;
        continue;
      }
    }
    out.push(x, y);
  }
  if (out.length < 4) {
    // Todos los puntos eran el mismo: conserva un tramo degenerado para que la arista exista.
    const lx = points[n * 2 - 2] ?? 0;
    const ly = points[n * 2 - 1] ?? 0;
    out.push(lx, ly);
  }
  return out;
}

/**
 * Convierte una polilínea en órdenes de dibujo con esquinas redondeadas.
 * El radio de cada esquina se limita a la mitad del tramo más corto que la toca, para que no se solapen.
 */
export function roundedCorners(points: readonly number[], r: number = CORNER_RADIUS): PathOp[] {
  const n = Math.floor(points.length / 2);
  if (n === 0) return [];
  const ops: PathOp[] = [{ op: 'move', x: points[0] ?? 0, y: points[1] ?? 0 }];
  for (let i = 1; i < n - 1; i++) {
    const px = points[(i - 1) * 2] ?? 0, py = points[(i - 1) * 2 + 1] ?? 0;
    const cx = points[i * 2] ?? 0, cy = points[i * 2 + 1] ?? 0;
    const nx = points[(i + 1) * 2] ?? 0, ny = points[(i + 1) * 2 + 1] ?? 0;
    const lin = Math.hypot(cx - px, cy - py);
    const lout = Math.hypot(nx - cx, ny - cy);
    const radius = Math.min(r, lin / 2, lout / 2);
    if (radius < EPS) ops.push({ op: 'line', x: cx, y: cy });
    else ops.push({ op: 'arc', x1: cx, y1: cy, x2: nx, y2: ny, r: radius });
  }
  if (n >= 2) ops.push({ op: 'line', x: points[n * 2 - 2] ?? 0, y: points[n * 2 - 1] ?? 0 });
  return ops;
}

/** Último tramo no degenerado: [px, py, ex, ey] (de donde viene y donde termina la flecha). */
export function lastSegment(points: readonly number[]): [number, number, number, number] | null {
  const n = Math.floor(points.length / 2);
  if (n < 2) return null;
  const ex = points[n * 2 - 2] ?? 0;
  const ey = points[n * 2 - 1] ?? 0;
  for (let i = n - 2; i >= 0; i--) {
    const px = points[i * 2] ?? 0;
    const py = points[i * 2 + 1] ?? 0;
    if (Math.abs(px - ex) >= EPS || Math.abs(py - ey) >= EPS) return [px, py, ex, ey];
  }
  return null;
}

/** Punto medio del tramo más largo (donde va la etiqueta). */
export function labelAnchor(points: readonly number[]): { x: number; y: number } | null {
  const n = Math.floor(points.length / 2);
  if (n < 2) return null;
  let best = -1;
  let at = { x: points[0] ?? 0, y: points[1] ?? 0 };
  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i * 2] ?? 0, y0 = points[i * 2 + 1] ?? 0;
    const x1 = points[i * 2 + 2] ?? 0, y1 = points[i * 2 + 3] ?? 0;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > best) {
      best = len;
      at = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }
  }
  return at;
}

/** Primer tramo no degenerado, en el mismo formato que lastSegment: [desdeX, desdeY, puntaX, puntaY]. */
export function firstSegment(points: readonly number[]): [number, number, number, number] | null {
  const n = Math.floor(points.length / 2);
  if (n < 2) return null;
  const sx = points[0] ?? 0;
  const sy = points[1] ?? 0;
  for (let i = 1; i < n; i++) {
    const px = points[i * 2] ?? 0;
    const py = points[i * 2 + 1] ?? 0;
    if (Math.abs(px - sx) >= EPS || Math.abs(py - sy) >= EPS) return [px, py, sx, sy];
  }
  return null;
}

/** Cabezas efectivas: las del modelo o, si faltan, las típicas del tipo de relación. */
export function headsOf(rel: Pick<RelationshipModel, 'type' | 'sourceHead' | 'targetHead'>): { source: HeadType; target: HeadType } {
  if (rel.sourceHead !== undefined || rel.targetHead !== undefined) {
    return { source: rel.sourceHead ?? 'none', target: rel.targetHead ?? 'none' };
  }
  switch (rel.type) {
    case 'EXTENDS':
    case 'IMPLEMENTS': return { source: 'none', target: 'triangle' };
    case 'COMPOSITION': return { source: 'diamond-filled', target: 'none' };
    case 'AGGREGATION': return { source: 'diamond', target: 'none' };
    default: return { source: 'none', target: 'open' };
  }
}

export type HeadShape =
  | { kind: 'poly'; pts: number[]; closed: boolean; fill: 'none' | 'line' | 'bg' }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: 'bg' };

export interface HeadGeometry {
  /** Cuánto se acorta la línea en ese extremo (0 = la línea llega a la punta). */
  inset: number;
  shapes: HeadShape[];
}

const HEAD_L = 12;
const HEAD_W = 6;
const DIAMOND_HALF = 9;
const CIRCLE_R = 7;
const SQUARE = 8;

/** Geometría de una cabeza con la punta en (tx,ty), mirando desde (fx,fy). */
export function headGeometry(type: HeadType, fx: number, fy: number, tx: number, ty: number): HeadGeometry {
  const len = Math.hypot(fx - tx, fy - ty) || 1;
  const ux = (fx - tx) / len; // de la punta hacia atrás
  const uy = (fy - ty) / len;
  const nx = -uy;
  const ny = ux;
  const P = (a: number, b: number): [number, number] => [tx + ux * a + nx * b, ty + uy * a + ny * b];
  const flat = (...ps: [number, number][]): number[] => ps.flat();
  switch (type) {
    case 'none':
      return { inset: 0, shapes: [] };
    case 'open':
      return { inset: 0, shapes: [{ kind: 'poly', pts: flat(P(HEAD_L, HEAD_W), P(0, 0), P(HEAD_L, -HEAD_W)), closed: false, fill: 'none' }] };
    case 'triangle':
      return { inset: HEAD_L, shapes: [{ kind: 'poly', pts: flat(P(0, 0), P(HEAD_L, HEAD_W), P(HEAD_L, -HEAD_W)), closed: true, fill: 'bg' }] };
    case 'diamond':
    case 'diamond-filled': {
      const w = HEAD_W * 0.85;
      const pts = flat(P(0, 0), P(DIAMOND_HALF, w), P(2 * DIAMOND_HALF, 0), P(DIAMOND_HALF, -w));
      return { inset: 2 * DIAMOND_HALF, shapes: [{ kind: 'poly', pts, closed: true, fill: type === 'diamond' ? 'bg' : 'line' }] };
    }
    case 'cross': {
      const c = 8, s = 4.5;
      return {
        inset: 0,
        shapes: [
          { kind: 'poly', pts: flat(P(c - s, -s), P(c + s, s)), closed: false, fill: 'none' },
          { kind: 'poly', pts: flat(P(c - s, s), P(c + s, -s)), closed: false, fill: 'none' },
        ],
      };
    }
    case 'plus':
    case 'circle': {
      const [cx, cy] = P(CIRCLE_R, 0);
      const shapes: HeadShape[] = [{ kind: 'circle', cx, cy, r: CIRCLE_R, fill: 'bg' }];
      if (type === 'plus') {
        // Anidamiento (+--): círculo con cruz.
        shapes.push({ kind: 'poly', pts: flat(P(0, 0), P(2 * CIRCLE_R, 0)), closed: false, fill: 'none' });
        shapes.push({ kind: 'poly', pts: flat(P(CIRCLE_R, -CIRCLE_R), P(CIRCLE_R, CIRCLE_R)), closed: false, fill: 'none' });
      }
      return { inset: 2 * CIRCLE_R, shapes };
    }
    case 'square': {
      const h = SQUARE / 2;
      return { inset: SQUARE, shapes: [{ kind: 'poly', pts: flat(P(0, -h), P(0, h), P(SQUARE, h), P(SQUARE, -h)), closed: true, fill: 'bg' }] };
    }
  }
}

/** Acorta los extremos de una polilínea (sin pasar del punto vecino). */
export function trimEnds(points: readonly number[], startInset: number, endInset: number): number[] {
  const out = points.slice();
  const n = Math.floor(out.length / 2);
  if (n < 2) return out;
  const move = (i: number, j: number, d: number): void => {
    if (d <= 0) return;
    const x = out[i * 2] ?? 0, y = out[i * 2 + 1] ?? 0;
    const ox = out[j * 2] ?? 0, oy = out[j * 2 + 1] ?? 0;
    const l = Math.hypot(ox - x, oy - y);
    if (l < EPS) return;
    const k = Math.min(d, l - EPS) / l;
    out[i * 2] = x + (ox - x) * k;
    out[i * 2 + 1] = y + (oy - y) * k;
  };
  move(0, 1, startInset);
  move(n - 1, n - 2, endInset);
  return out;
}

/** Posición de una multiplicidad: un poco hacia dentro de la arista y desplazada a un lado. */
export function endLabelPos(fx: number, fy: number, tx: number, ty: number, along = 16, side = 9): { x: number; y: number } {
  const len = Math.hypot(fx - tx, fy - ty) || 1;
  const ux = (fx - tx) / len;
  const uy = (fy - ty) / len;
  return { x: tx + ux * along - uy * side, y: ty + uy * along + ux * side };
}
