// src/render/canvas/overrides.ts — posiciones movidas a mano sobre un layout (puro, sin React).
// Un override es un desplazamiento (dx, dy) respecto a la posición que calculó el layout.
// Así "Restablecer" es simplemente vaciar el mapa: las tarjetas vuelven a la posición del layout.
import type { EdgePath, LayoutResult, NodeBox, PackageBox } from '../types';

export interface Offset {
  dx: number;
  dy: number;
}
export type Overrides = ReadonlyMap<string, Offset>;

/** Mismo margen que usa ELK dentro de los paquetes (arriba deja sitio al nombre). */
const PKG_PAD = { top: 30, left: 16, bottom: 16, right: 16 };
const EPS = 0.01;

export const EMPTY_OVERRIDES: Overrides = new Map();

/** Suma (dx, dy) al desplazamiento de una tarjeta. Devuelve un mapa nuevo. */
export function moveBy(overrides: Overrides, id: string, dx: number, dy: number): Overrides {
  const prev = overrides.get(id);
  const next = new Map(overrides);
  next.set(id, { dx: (prev?.dx ?? 0) + dx, dy: (prev?.dy ?? 0) + dy });
  return next;
}

/** Fija el desplazamiento de una tarjeta. Devuelve un mapa nuevo. */
export function setOverride(overrides: Overrides, id: string, offset: Offset): Overrides {
  const next = new Map(overrides);
  next.set(id, { dx: offset.dx, dy: offset.dy });
  return next;
}

/** Quita todos los desplazamientos (posición original del layout). */
export function clearOverrides(): Overrides {
  return EMPTY_OVERRIDES;
}

export function hasOverrides(overrides: Overrides): boolean {
  for (const o of overrides.values()) if (Math.abs(o.dx) > EPS || Math.abs(o.dy) > EPS) return true;
  return false;
}

/**
 * Aplica los desplazamientos al layout sin mutarlo:
 * - mueve las tarjetas;
 * - en las aristas conectadas mueve el extremo y, si la ruta es ortogonal, añade un codo para que siga siendo ortogonal;
 * - agranda la caja del paquete para que siga conteniendo sus tarjetas;
 * - recalcula bounds.
 */
export function applyOverrides(layout: LayoutResult, overrides: Overrides): LayoutResult {
  if (!hasOverrides(overrides)) return layout;
  const off = (id: string): Offset | undefined => {
    const o = overrides.get(id);
    return o && (Math.abs(o.dx) > EPS || Math.abs(o.dy) > EPS) ? o : undefined;
  };

  const nodes: NodeBox[] = layout.nodes.map((n) => {
    const o = off(n.id);
    return o ? { ...n, x: n.x + o.dx, y: n.y + o.dy } : n;
  });

  const edges: EdgePath[] = layout.edges.map((e) => {
    const os = off(e.source);
    const ot = off(e.target);
    if (!os && !ot) return e;
    // Si ambos extremos se movieron lo mismo, la arista entera se traslada.
    if (os && ot && Math.abs(os.dx - ot.dx) < EPS && Math.abs(os.dy - ot.dy) < EPS) {
      return { ...e, points: translate(e.points, os.dx, os.dy) };
    }
    let pts = e.points.slice();
    const ortho = e.routing === 'orthogonal';
    if (os) pts = moveStart(pts, os, ortho);
    if (ot) pts = reverse(moveStart(reverse(pts), ot, ortho));
    return { ...e, points: pts };
  });

  const byPackage = new Map<string, NodeBox[]>();
  for (const n of nodes) {
    if (n.packageName === undefined) continue;
    const list = byPackage.get(n.packageName);
    if (list) list.push(n);
    else byPackage.set(n.packageName, [n]);
  }
  const packages: PackageBox[] = layout.packages.map((p) => {
    const members = byPackage.get(p.name);
    if (!members || !members.some((m) => off(m.id))) return p;
    let x0 = p.x, y0 = p.y, x1 = p.x + p.w, y1 = p.y + p.h;
    for (const m of members) {
      x0 = Math.min(x0, m.x - PKG_PAD.left);
      y0 = Math.min(y0, m.y - PKG_PAD.top);
      x1 = Math.max(x1, m.x + m.w + PKG_PAD.right);
      y1 = Math.max(y1, m.y + m.h + PKG_PAD.bottom);
    }
    return { ...p, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });

  return { nodes, edges, packages, bounds: boundsOf(nodes, packages, edges, layout.bounds) };
}

function translate(points: readonly number[], dx: number, dy: number): number[] {
  const out = points.slice();
  for (let i = 0; i + 1 < out.length; i += 2) {
    out[i] = (out[i] ?? 0) + dx;
    out[i + 1] = (out[i + 1] ?? 0) + dy;
  }
  return out;
}

function reverse(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i] ?? 0, points[i + 1] ?? 0);
  return out;
}

/**
 * Mueve el primer punto de la polilínea. En rutas ortogonales conserva la orientación del primer tramo
 * (sale de la tarjeta igual que antes) y añade un codo para volver a unirse con el resto de la ruta.
 */
function moveStart(points: number[], o: Offset, ortho: boolean): number[] {
  if (points.length < 4) return points;
  const sx = (points[0] ?? 0) + o.dx;
  const sy = (points[1] ?? 0) + o.dy;
  const rest = points.slice(2);
  if (!ortho) return [sx, sy, ...rest];
  const nx = rest[0] ?? 0;
  const ny = rest[1] ?? 0;
  const vertical = Math.abs((points[0] ?? 0) - nx) < EPS;
  // Primer tramo vertical: baja/sube desde la tarjeta hasta la altura del siguiente punto y luego en horizontal.
  // Primer tramo horizontal: igual pero girado.
  const elbow = vertical ? [sx, ny] : [nx, sy];
  return [sx, sy, ...elbow, ...rest];
}

function boundsOf(
  nodes: readonly NodeBox[],
  packages: readonly PackageBox[],
  edges: readonly EdgePath[],
  fallback: LayoutResult['bounds'],
): LayoutResult['bounds'] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const box = (x: number, y: number, w: number, h: number): void => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  };
  for (const n of nodes) box(n.x, n.y, n.w, n.h);
  for (const p of packages) box(p.x, p.y, p.w, p.h);
  for (const e of edges) {
    for (let i = 0; i + 1 < e.points.length; i += 2) box(e.points[i] ?? 0, e.points[i + 1] ?? 0, 0, 0);
  }
  if (!Number.isFinite(x0)) return fallback;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
