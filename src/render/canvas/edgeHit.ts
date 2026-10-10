// src/render/canvas/edgeHit.ts — hit-test de aristas: distancia a la polilínea (puro).
import type { LayoutResult } from '../types';
import { queryEdges, type SpatialIndex } from './spatial';

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export function distToPolyline(pts: readonly number[], x: number, y: number): number {
  if (pts.length === 2) return Math.hypot(x - (pts[0] ?? 0), y - (pts[1] ?? 0));
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    best = Math.min(best, distToSegment(x, y, pts[k] ?? 0, pts[k + 1] ?? 0, pts[k + 2] ?? 0, pts[k + 3] ?? 0));
  }
  return best;
}

/**
 * Índice de la arista más cercana a (x, y) a distancia ≤ tolWorld, o null. Pasa tolPx / scale para
 * tener la tolerancia en píxeles de pantalla. Con `index` solo se miran las aristas cuya caja toca el
 * cuadrado de búsqueda (índice espacial); sin él, todas.
 */
export function hitTestEdge(
  layout: LayoutResult,
  x: number,
  y: number,
  tolWorld: number,
  index?: SpatialIndex,
): number | null {
  const candidates: Iterable<number> = index
    ? queryEdges(index, { x: x - tolWorld, y: y - tolWorld, w: 2 * tolWorld, h: 2 * tolWorld })
    : layout.edges.keys();
  let best: number | null = null;
  let bestD = tolWorld;
  for (const i of candidates) {
    const e = layout.edges[i];
    if (!e) continue;
    const d = distToPolyline(e.points, x, y);
    // Con empate gana la última (se dibuja encima).
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
