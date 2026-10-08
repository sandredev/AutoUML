// src/render/canvas/dragNode.ts — geometría pura del arrastre de entidades.
// Sin DOM ni React: mover, reajustar localmente, reenrutar, reagrupar paquetes e interpolar.
import type { EdgePath, LayoutResult, NodeBox, PackageBox } from '../types';
import { PACKAGE } from '../style/contract';

export interface Point { x: number; y: number }

export const nodeGap = 24;
export const packageGap = PACKAGE.margin;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function center(b: NodeBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function clipToBox(b: NodeBox, tx: number, ty: number): Point {
  const c = center(b);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

// Ruta suave de borde a borde; el último punto toca al destino (punta de flecha).
export function routeEdge(src: NodeBox, tgt: NodeBox): number[] {
  if (src.id === tgt.id) {
    const x = src.x + src.w;
    const y = src.y + src.h / 2;
    const r = Math.max(8, Math.min(30, src.h / 3));
    return [x, y - r, x + r * 1.5, y - r, x + r * 1.5, y + r, x, y + r];
  }
  const sc = center(src);
  const tc = center(tgt);
  const a = clipToBox(src, tc.x, tc.y);
  const b = clipToBox(tgt, sc.x, sc.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return [a.x, a.y, a.x + dx * 0.1, a.y + dy * 0.4, b.x - dx * 0.1, b.y - dy * 0.4, b.x, b.y];
  }
  return [a.x, a.y, a.x + dx * 0.4, a.y + dy * 0.1, b.x - dx * 0.4, b.y - dy * 0.1, b.x, b.y];
}

export function rerouteEdges(edges: EdgePath[], nodes: NodeBox[], changed: Set<string> | null): EdgePath[] {
  if (changed !== null && changed.size === 0) return edges;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((e) => {
    if (changed !== null && !changed.has(e.source) && !changed.has(e.target)) return e;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) return e;
    return { ...e, points: routeEdge(s, t) };
  });
}

// Recalcula la caja de cada paquete como envolvente de sus miembros + margen + pestaña.
export function fitPackages(nodes: NodeBox[], packages: PackageBox[]): PackageBox[] {
  const ext = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  for (const n of nodes) {
    if (n.packageName === undefined) continue;
    const e = ext.get(n.packageName);
    if (e) {
      e.x0 = Math.min(e.x0, n.x);
      e.y0 = Math.min(e.y0, n.y);
      e.x1 = Math.max(e.x1, n.x + n.w);
      e.y1 = Math.max(e.y1, n.y + n.h);
    } else {
      ext.set(n.packageName, { x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h });
    }
  }
  const out: PackageBox[] = [];
  for (const p of packages) {
    const e = ext.get(p.name);
    if (!e) continue;
    const x = e.x0 - PACKAGE.margin;
    const y = e.y0 - PACKAGE.margin - PACKAGE.tabH;
    const minW = (p.tabW ?? 0) + PACKAGE.margin;
    const w = Math.max(e.x1 - e.x0 + 2 * PACKAGE.margin, minW);
    const h = e.y1 - y + PACKAGE.margin;
    out.push({ ...p, x, y, w, h });
  }
  return out;
}

export function boundsOf(nodes: NodeBox[], packages: PackageBox[]): LayoutResult['bounds'] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, w: number, h: number): void => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const n of nodes) add(n.x, n.y, n.w, n.h);
  for (const p of packages) add(p.x, p.y, p.w, p.h);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Reconstruye aristas (solo las de nodos movidos respecto a `layout`), paquetes y límites.
export function rebuildLayout(layout: LayoutResult, nodes: NodeBox[]): LayoutResult {
  const prev = new Map(layout.nodes.map((n) => [n.id, n]));
  const changed = new Set<string>();
  for (const n of nodes) {
    const p = prev.get(n.id);
    if (!p || p.x !== n.x || p.y !== n.y) changed.add(n.id);
  }
  const edges = rerouteEdges(layout.edges, nodes, changed);
  const packages = fitPackages(nodes, layout.packages);
  return { nodes, edges, packages, bounds: boundsOf(nodes, packages) };
}

// Vista previa durante el arrastre: mueve el nodo y reenruta solo sus aristas.
export function moveNodePreview(layout: LayoutResult, id: string, x: number, y: number): LayoutResult {
  let found = false;
  const nodes = layout.nodes.map((n) => {
    if (n.id !== id) return n;
    found = true;
    return { ...n, x, y };
  });
  if (!found) return layout;
  const edges = rerouteEdges(layout.edges, nodes, new Set([id]));
  return { ...layout, nodes, edges, bounds: boundsOf(nodes, layout.packages) };
}

// Paquete más interno (menor área) que contiene el punto.
export function packageAt(packages: PackageBox[], x: number, y: number): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const p of packages) {
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) continue;
    const area = p.w * p.h;
    if (area < bestArea) {
      bestArea = area;
      best = p.name;
    }
  }
  return best;
}

// Reajuste local: el nodo soltado queda fijo y empuja en cascada a los vecinos que solapa.
export function resolveOverlaps(nodes: NodeBox[], movedId: string, inScope: (n: NodeBox) => boolean, gap = nodeGap): NodeBox[] {
  const out = nodes.map((n) => ({ ...n }));
  const idx = new Map(out.map((n, i) => [n.id, i]));
  const scoped = out.filter((n) => n.id !== movedId && inScope(n));
  const queue: string[] = [movedId];
  const limit = scoped.length * 20 + 50;
  let guard = 0;
  while (queue.length > 0 && guard < limit) {
    guard++;
    const pid = queue.shift() ?? '';
    const p = out[idx.get(pid) ?? -1];
    if (!p) continue;
    const pc = center(p);
    for (const q of scoped) {
      if (q.id === p.id) continue;
      const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) + gap;
      const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) + gap;
      if (ox <= 0 || oy <= 0) continue;
      const qc = center(q);
      if (ox < oy) q.x += (qc.x >= pc.x ? 1 : -1) * ox;
      else q.y += (qc.y >= pc.y ? 1 : -1) * oy;
      queue.push(q.id);
    }
  }
  return out;
}

// Separa paquetes que se solapan; `pinned` no se mueve. Devuelve los nodos trasladados.
export function separatePackages(nodes: NodeBox[], packages: PackageBox[], pinned: string, gap = packageGap): NodeBox[] {
  const boxes = packages.map((p) => ({ ...p }));
  const shift = new Map<string, Point>();
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
        if (ox <= 0 || oy <= 0) continue;
        const mover = b.name === pinned ? a : b;
        const other = mover === a ? b : a;
        const dirX = mover.x + mover.w / 2 >= other.x + other.w / 2 ? 1 : -1;
        const dirY = mover.y + mover.h / 2 >= other.y + other.h / 2 ? 1 : -1;
        const dx = ox < oy ? dirX * ox : 0;
        const dy = ox < oy ? 0 : dirY * oy;
        mover.x += dx;
        mover.y += dy;
        const s = shift.get(mover.name) ?? { x: 0, y: 0 };
        shift.set(mover.name, { x: s.x + dx, y: s.y + dy });
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (shift.size === 0) return nodes;
  return nodes.map((n) => {
    const s = n.packageName === undefined ? undefined : shift.get(n.packageName);
    return s ? { ...n, x: n.x + s.x, y: n.y + s.y } : n;
  });
}

// Suelta el nodo: reasigna paquete, reajuste local, ajusta y separa paquetes, reenruta.
export function finalizeDrop(layout: LayoutResult, id: string, x: number, y: number, targetPackage: string | null): LayoutResult {
  const moving = layout.nodes.find((n) => n.id === id);
  if (!moving) return layout;
  const pkg = targetPackage ?? moving.packageName;
  let nodes = layout.nodes.map((n) => {
    if (n.id !== id) return n;
    const next: NodeBox = { ...n, x, y };
    if (pkg !== undefined) next.packageName = pkg;
    return next;
  });
  nodes = resolveOverlaps(nodes, id, (n) => n.packageName === pkg);
  if (pkg !== undefined) nodes = separatePackages(nodes, fitPackages(nodes, layout.packages), pkg);
  return rebuildLayout(layout, nodes);
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

// Interpola posiciones de nodos y paquetes; las aristas de nodos en tránsito se reenrutan.
export function interpolateLayout(from: LayoutResult, to: LayoutResult, t: number): LayoutResult {
  if (t >= 1) return to;
  const fm = new Map(from.nodes.map((n) => [n.id, n]));
  const moving = new Set<string>();
  const nodes = to.nodes.map((n) => {
    const f = fm.get(n.id);
    if (!f || (f.x === n.x && f.y === n.y)) return n;
    moving.add(n.id);
    return { ...n, x: lerp(f.x, n.x, t), y: lerp(f.y, n.y, t) };
  });
  const pm = new Map(from.packages.map((p) => [p.name, p]));
  const packages = to.packages.map((p) => {
    const f = pm.get(p.name);
    if (!f) return p;
    return { ...p, x: lerp(f.x, p.x, t), y: lerp(f.y, p.y, t), w: lerp(f.w, p.w, t), h: lerp(f.h, p.h, t) };
  });
  const edges = rerouteEdges(to.edges, nodes, moving);
  return { nodes, edges, packages, bounds: boundsOf(nodes, packages) };
}
