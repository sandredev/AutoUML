// src/render/canvas/overrides.ts — posiciones movidas a mano sobre un layout (puro, sin React).
// Un override es un desplazamiento (dx, dy) respecto a la posición que calculó el layout.
// Así "Restablecer" es simplemente vaciar el mapa: las tarjetas vuelven a la posición del layout.
import type { EdgePath, LayoutResult, NodeBox, NoteBox, PackageBox } from '../types';

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

/**
 * Migra los desplazamientos a un layout nuevo del MISMO documento (recarga, plegado, hide): se
 * conservan los de los ids que siguen existiendo. Si no se pierde ninguno devuelve el mismo mapa.
 */
export function retainOverrides(overrides: Overrides, ids: Iterable<string>): Overrides {
  if (overrides.size === 0) return overrides;
  const keep = new Set(ids);
  let dropped = false;
  const next = new Map<string, Offset>();
  for (const [id, o] of overrides) {
    if (keep.has(id)) next.set(id, o);
    else dropped = true;
  }
  if (!dropped) return overrides;
  return next.size === 0 ? EMPTY_OVERRIDES : next;
}

export function hasOverrides(overrides: Overrides): boolean {
  for (const o of overrides.values()) if (Math.abs(o.dx) > EPS || Math.abs(o.dy) > EPS) return true;
  return false;
}

/**
 * Aplica los desplazamientos al layout sin mutarlo:
 * - mueve las tarjetas;
 * - en las aristas conectadas mueve el extremo y, si la ruta es ortogonal, añade un codo para que siga siendo ortogonal
 *   (el codo evita las cajas de las tarjetas: como mucho 2-3 tramos);
 * - agranda la caja del paquete para que siga conteniendo sus tarjetas, y la ENCOGE cuando una tarjeta sale de él;
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
  // Obstáculos para el re-ruteo: las cajas de las tarjetas ya movidas.
  const obstacles: Box[] = nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));

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
    if (os) pts = moveStart(pts, os, ortho, obstacles);
    if (ot) pts = reverse(moveStart(reverse(pts), ot, ortho, obstacles));
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
    if (!members || members.length === 0 || !members.some((m) => off(m.id))) return p;
    // Si alguna tarjeta salió de la caja (con padding), se recalcula ajustada a los
    // miembros actuales: contiene a todos pero el lado abandonado se encoge.
    const escaped = members.some(
      (m) =>
        m.x - PKG_PAD.left < p.x - EPS ||
        m.y - PKG_PAD.top < p.y - EPS ||
        m.x + m.w + PKG_PAD.right > p.x + p.w + EPS ||
        m.y + m.h + PKG_PAD.bottom > p.y + p.h + EPS,
    );
    if (escaped) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const m of members) {
        x0 = Math.min(x0, m.x - PKG_PAD.left);
        y0 = Math.min(y0, m.y - PKG_PAD.top);
        x1 = Math.max(x1, m.x + m.w + PKG_PAD.right);
        y1 = Math.max(y1, m.y + m.h + PKG_PAD.bottom);
      }
      if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return p;
      return { ...p, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    let x0 = p.x, y0 = p.y, x1 = p.x + p.w, y1 = p.y + p.h;
    for (const m of members) {
      x0 = Math.min(x0, m.x - PKG_PAD.left);
      y0 = Math.min(y0, m.y - PKG_PAD.top);
      x1 = Math.max(x1, m.x + m.w + PKG_PAD.right);
      y1 = Math.max(y1, m.y + m.h + PKG_PAD.bottom);
    }
    return { ...p, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });

  // Las notas ancladas acompañan a su clase.
  let notes: NoteBox[] | undefined = layout.notes;
  if (notes) {
    notes = notes.map((n) => {
      const o = n.anchor !== undefined ? off(n.anchor) : undefined;
      return o ? { ...n, x: n.x + o.dx, y: n.y + o.dy } : n;
    });
  }

  const out: LayoutResult = { nodes, edges, packages, bounds: boundsOf(nodes, [...packages, ...(notes ?? [])], edges, layout.bounds) };
  if (notes) out.notes = notes;
  return out;
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
 * Con `obstacles`, el codo elegido no cruza el interior de las cajas (origen, destino y demás
 * tarjetas): si el codo ingenuo cruza, se prueba la orientación alternativa (2-3 tramos).
 */
export function moveStart(points: number[], o: Offset, ortho: boolean, obstacles?: readonly Box[]): number[] {
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
  const first = vertical ? [sx, ny] : [nx, sy];
  if (!obstacles || obstacles.length === 0) return [sx, sy, ...first, ...rest];
  const alt = vertical ? [nx, sy] : [sx, ny];
  const crosses = (elbow: number[]): number => {
    let n = 0;
    const segs: Array<[number, number, number, number]> = [
      [sx, sy, elbow[0] ?? 0, elbow[1] ?? 0],
      [elbow[0] ?? 0, elbow[1] ?? 0, nx, ny],
    ];
    for (const [x1, y1, x2, y2] of segs) {
      for (const box of obstacles) {
        if (segCrossesBox(x1, y1, x2, y2, box)) n += 1;
      }
    }
    return n;
  };
  // Empate o mejora ingenua: se conserva el codo actual (no se salta sin motivo).
  const elbow = crosses(alt) < crosses(first) ? alt : first;
  return [sx, sy, ...elbow, ...rest];
}

/** Caja para el re-ruteo (una tarjeta ya movida). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function strictlyInside(px: number, py: number, b: Box): boolean {
  return px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return Math.min(ax, cx) - EPS <= bx && bx <= Math.max(ax, cx) + EPS && Math.min(ay, cy) - EPS <= by && by <= Math.max(ay, cy) + EPS;
}

/** Cruce (incluido el roce) de dos segmentos. */
function segsCross(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): boolean {
  const d1 = orient(x3, y3, x4, y4, x1, y1);
  const d2 = orient(x3, y3, x4, y4, x2, y2);
  const d3 = orient(x1, y1, x2, y2, x3, y3);
  const d4 = orient(x1, y1, x2, y2, x4, y4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (Math.abs(d1) < EPS && onSegment(x3, y3, x1, y1, x4, y4)) return true;
  if (Math.abs(d2) < EPS && onSegment(x3, y3, x2, y2, x4, y4)) return true;
  if (Math.abs(d3) < EPS && onSegment(x1, y1, x3, y3, x2, y2)) return true;
  if (Math.abs(d4) < EPS && onSegment(x1, y1, x4, y4, x2, y2)) return true;
  return false;
}

/** true si el segmento atraviesa el interior de la caja (best-effort). */
function segCrossesBox(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  if (Math.hypot(x2 - x1, y2 - y1) < EPS) return false;
  if (strictlyInside(x1, y1, b) || strictlyInside(x2, y2, b)) return true;
  const x0 = b.x, y0 = b.y, x3 = b.x + b.w, y3 = b.y + b.h;
  return (
    segsCross(x1, y1, x2, y2, x0, y0, x3, y0) ||
    segsCross(x1, y1, x2, y2, x3, y0, x3, y3) ||
    segsCross(x1, y1, x2, y2, x3, y3, x0, y3) ||
    segsCross(x1, y1, x2, y2, x0, y3, x0, y0)
  );
}

/** Convierte el record del sidecar a Overrides (filtra valores no finitos). */
export function overridesFromRecord(record: Record<string, { dx: number; dy: number }>): Overrides {
  const next = new Map<string, Offset>();
  if (record === null || typeof record !== 'object') return EMPTY_OVERRIDES;
  for (const [id, o] of Object.entries(record)) {
    if (typeof o?.dx !== 'number' || typeof o?.dy !== 'number') continue;
    if (!Number.isFinite(o.dx) || !Number.isFinite(o.dy)) continue;
    next.set(id, { dx: o.dx, dy: o.dy });
  }
  return next.size === 0 ? EMPTY_OVERRIDES : next;
}

/** Convierte Overrides al record del sidecar (copias, listo para JSON). */
export function overridesToRecord(overrides: Overrides): Record<string, { dx: number; dy: number }> {
  const out: Record<string, { dx: number; dy: number }> = {};
  for (const [id, o] of overrides) out[id] = { dx: o.dx, dy: o.dy };
  return out;
}

function boundsOf(
  nodes: readonly NodeBox[],
  packages: readonly { x: number; y: number; w: number; h: number }[],
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
