// src/render/canvas/edgePath.ts — geometría de aristas para el dibujo (puro, sin DOM).

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
