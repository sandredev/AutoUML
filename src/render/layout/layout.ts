// src/render/layout/layout.ts — layout en dos niveles: dagre dentro de cada paquete y dagre entre paquetes.
// Módulo puro (sin DOM/React/Electron). Los paquetes nunca se solapan porque son nodos del grafo exterior.
import * as dagreNs from '@dagrejs/dagre';
import type { DiagramModel } from '../../core/model';
import { DEFAULT_DETAIL, PACKAGE, type CardGeometry } from '../style/contract';
import type { EdgePath, LayoutOptions, LayoutResult, NodeBox, PackageBox } from '../types';
import { cardContentOf, makeMeasurer, measureCardBox } from './cardModel';

// Interop CJS/ESM: en Node el namespace puede traer solo `default`.
const dagre = (dagreNs as unknown as { default?: typeof dagreNs }).default ?? dagreNs;

const defaultPackage = '(default package)';
const bigGroup = 400;

interface Pt { x: number; y: number }
interface DNode { id: string; w: number; h: number }
interface DEdge { v: string; w: string; name: string }
interface DOut { pos: Map<string, Pt>; pts: Map<string, Pt[]>; w: number; h: number }
interface Cfg { dir: 'TB' | 'LR'; rankSep: number; nodeSep: number }
interface Rect { x: number; y: number; w: number; h: number }

const fin = (n: number): boolean => Number.isFinite(n);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function runDagre(nodes: DNode[], edges: DEdge[], cfg: Cfg): DOut {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  const conf: Record<string, string | number> = {
    rankdir: cfg.dir,
    ranksep: cfg.rankSep,
    nodesep: cfg.nodeSep,
    edgesep: 12,
    marginx: 0,
    marginy: 0,
  };
  if (nodes.length > bigGroup) {
    conf.ranker = 'longest-path';
    conf.acyclicer = 'greedy';
  }
  g.setGraph(conf as Parameters<typeof g.setGraph>[0]);
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h });
  for (const e of edges) g.setEdge(e.v, e.w, {}, e.name);
  dagre.layout(g);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const pos = new Map<string, Pt>();
  for (const n of nodes) {
    const p = g.node(n.id) as unknown as Pt | undefined;
    const cx = p && fin(p.x) ? p.x : 0;
    const cy = p && fin(p.y) ? p.y : 0;
    const x = cx - n.w / 2;
    const y = cy - n.h / 2;
    pos.set(n.id, { x, y });
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + n.w);
    y1 = Math.max(y1, y + n.h);
  }
  const pts = new Map<string, Pt[]>();
  for (const e of edges) {
    const d = g.edge({ v: e.v, w: e.w, name: e.name }) as unknown as { points?: Pt[] } | undefined;
    const raw = (d?.points ?? []).filter((q) => fin(q.x) && fin(q.y)).map((q) => ({ x: q.x, y: q.y }));
    for (const q of raw) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
    pts.set(e.name, raw);
  }
  if (!fin(x0)) return { pos, pts, w: 0, h: 0 };
  for (const p of pos.values()) {
    p.x -= x0;
    p.y -= y0;
  }
  for (const list of pts.values()) {
    for (const q of list) {
      q.x -= x0;
      q.y -= y0;
    }
  }
  return { pos, pts, w: x1 - x0, h: y1 - y0 };
}

/** Punto del borde de la caja en la dirección (px,py) desde su centro. */
export function clipToBox(b: Rect, px: number, py: number): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return [cx, b.y + b.h];
  const hw = b.w / 2;
  const hh = b.h / 2;
  const s = Math.abs(dx) * hh > Math.abs(dy) * hw ? hw / Math.abs(dx) : hh / Math.abs(dy);
  return [cx + dx * s, cy + dy * s];
}

/** Arista suave de borde a borde (cuatro puntos: el dibujo los suaviza como spline). */
export function portRoute(src: Rect, tgt: Rect, dir: 'TB' | 'LR'): number[] {
  const scx = src.x + src.w / 2;
  const scy = src.y + src.h / 2;
  const tcx = tgt.x + tgt.w / 2;
  const tcy = tgt.y + tgt.h / 2;
  if (dir === 'TB') {
    const below = tgt.y > src.y + src.h;
    const above = tgt.y + tgt.h < src.y;
    if (below || above) {
      const sx = clamp(scx + (tcx - scx) * 0.25, src.x + 8, src.x + src.w - 8);
      const ex = clamp(tcx + (scx - tcx) * 0.25, tgt.x + 8, tgt.x + tgt.w - 8);
      const sy = below ? src.y + src.h : src.y;
      const ey = below ? tgt.y : tgt.y + tgt.h;
      const k = (ey - sy) * 0.45;
      return [sx, sy, sx, sy + k, ex, ey - k, ex, ey];
    }
  } else {
    const right = tgt.x > src.x + src.w;
    const left = tgt.x + tgt.w < src.x;
    if (right || left) {
      const sy = clamp(scy + (tcy - scy) * 0.25, src.y + 8, src.y + src.h - 8);
      const ey = clamp(tcy + (scy - tcy) * 0.25, tgt.y + 8, tgt.y + tgt.h - 8);
      const sx = right ? src.x + src.w : src.x;
      const ex = right ? tgt.x : tgt.x + tgt.w;
      const k = (ex - sx) * 0.45;
      return [sx, sy, sx + k, sy, ex - k, ey, ex, ey];
    }
  }
  const [sx, sy] = clipToBox(src, tcx, tcy);
  const [ex, ey] = clipToBox(tgt, scx, scy);
  return [sx, sy, ex, ey];
}

const laneGap = 16;
const avoidGap = 24;
const maxDetours = 13;

// Intersección propia entre segmentos (tocarse en un extremo no cuenta).
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function segXseg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)) return false;
  if (Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 !== o2 && o3 !== o4;
}

// ¿El segmento atraviesa el interior de la caja? (margen de 1 unidad; rozar el borde no cuenta).
function segHitsBox(ax: number, ay: number, bx: number, by: number, b: Rect): boolean {
  if (Math.max(ax, bx) < b.x + 1 || Math.min(ax, bx) > b.x + b.w - 1) return false;
  if (Math.max(ay, by) < b.y + 1 || Math.min(ay, by) > b.y + b.h - 1) return false;
  const x0 = b.x + 1;
  const y0 = b.y + 1;
  const x1 = b.x + b.w - 1;
  const y1 = b.y + b.h - 1;
  if (x0 >= x1 || y0 >= y1) return false;
  if (ax > x0 && ax < x1 && ay > y0 && ay < y1) return true;
  if (bx > x0 && bx < x1 && by > y0 && by < y1) return true;
  return segXseg(ax, ay, bx, by, x0, y0, x1, y0)
    || segXseg(ax, ay, bx, by, x1, y0, x1, y1)
    || segXseg(ax, ay, bx, by, x1, y1, x0, y1)
    || segXseg(ax, ay, bx, by, x0, y1, x0, y0);
}

function corridorClear(exx: number, exy: number, vx: number, vy: number, enx: number, eny: number, obstacles: Rect[]): boolean {
  const segs = [exx, exy, vx, vy, vx, vy, enx, eny];
  for (let i = 0; i + 3 < segs.length; i += 2) {
    const ax = segs[i] ?? 0;
    const ay = segs[i + 1] ?? 0;
    const bx = segs[i + 2] ?? 0;
    const by = segs[i + 3] ?? 0;
    for (const o of obstacles) {
      if (segHitsBox(ax, ay, bx, by, o)) return false;
    }
  }
  return true;
}

// Arista entre paquetes: sale por el borde del paquete origen, viaja por el
// pasillo entre paquetes y entra por el borde del destino. `lane/lanes`
// reparte las aristas paralelas del mismo par de paquetes para que no se
// solapen; si el pasillo choca con otro paquete o tarjeta, se desvía de forma
// acotada y determinista. Solo obstáculos ajenos a los extremos.
export function routeInterPackage(
  src: NodeBox,
  tgt: NodeBox,
  srcPkg: PackageBox,
  tgtPkg: PackageBox,
  lane: number,
  lanes: number,
  obstacles: Rect[],
): number[] {
  const scx = src.x + src.w / 2;
  const scy = src.y + src.h / 2;
  const tcx = tgt.x + tgt.w / 2;
  const tcy = tgt.y + tgt.h / 2;
  const [exx, exy] = clipToBox(srcPkg, tcx, tcy);
  const [enx, eny] = clipToBox(tgtPkg, scx, scy);
  const [sx, sy] = clipToBox(src, exx, exy);
  const [tx, ty] = clipToBox(tgt, enx, eny);
  const dx = enx - exx;
  const dy = eny - exy;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return [sx, sy, tx, ty];
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (exx + enx) / 2;
  const my = (exy + eny) / 2;
  const off = (lane - (lanes - 1) / 2) * laneGap;
  const candidates = [off];
  for (let k = 1; k <= 6; k++) {
    candidates.push(off + k * avoidGap, off - k * avoidGap);
  }
  let vx = mx + nx * off;
  let vy = my + ny * off;
  let tried = 0;
  for (const d of candidates) {
    if (tried >= maxDetours) break;
    tried++;
    const cx = mx + nx * d;
    const cy = my + ny * d;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    vx = cx;
    vy = cy;
    if (corridorClear(exx, exy, vx, vy, enx, eny, obstacles)) break;
  }
  return [sx, sy, exx, exy, vx, vy, enx, eny, tx, ty];
}

function pairKey(a: string, b: string): string {
  return a < b ? a + ' ' + b : b + ' ' + a;
}

interface Group { name: string; ids: string[] }

export function computeLayout(model: DiagramModel, opts?: LayoutOptions): LayoutResult {
  const summary = opts?.summary ?? model.summaryMode;
  const rankSep = opts?.rankSep ?? 80;
  const nodeSep = opts?.nodeSep ?? 40;
  const detail = opts?.detail ?? DEFAULT_DETAIL;
  const dir = opts?.direction ?? 'TB';
  if (model.types.length === 0) {
    return { nodes: [], edges: [], packages: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  }
  const measure = makeMeasurer();
  const sizes = new Map<string, { w: number; h: number; geometry: CardGeometry; pkg: string }>();
  const groups = new Map<string, Group>();
  for (const t of model.types) {
    if (sizes.has(t.id)) continue;
    const box = measureCardBox(cardContentOf(t, detail, summary), measure);
    const pkg = t.packageName || defaultPackage;
    sizes.set(t.id, { ...box, pkg });
    let g = groups.get(pkg);
    if (!g) {
      g = { name: pkg, ids: [] };
      groups.set(pkg, g);
    }
    g.ids.push(t.id);
  }
  const intra = new Map<string, DEdge[]>();
  const inter = new Map<string, DEdge>();
  model.relationships.forEach((r, idx) => {
    const a = sizes.get(r.source);
    const b = sizes.get(r.target);
    if (!a || !b || r.source === r.target) return;
    const hier = r.type === 'EXTENDS' || r.type === 'IMPLEMENTS';
    const v = hier ? r.target : r.source;
    const w = hier ? r.source : r.target;
    const pv = hier ? b.pkg : a.pkg;
    const pw = hier ? a.pkg : b.pkg;
    if (pv === pw) {
      const list = intra.get(pv) ?? [];
      list.push({ v, w, name: 'e' + idx });
      intra.set(pv, list);
    } else {
      const k = pv + ' ' + pw;
      const back = pw + ' ' + pv;
      if (!inter.has(k) && !inter.has(back)) inter.set(k, { v: pv, w: pw, name: 'p' + idx });
    }
  });
  const inner = new Map<string, { out: DOut; offX: number; offY: number; tabW: number }>();
  const outerNodes: DNode[] = [];
  for (const g of groups.values()) {
    const nodes = g.ids.map((id) => {
      const s = sizes.get(id);
      return { id, w: s?.w ?? 0, h: s?.h ?? 0 };
    });
    const out = runDagre(nodes, intra.get(g.name) ?? [], { dir, rankSep: rankSep * 0.75, nodeSep });
    const isBox = g.name !== defaultPackage;
    const tabW = Math.ceil(measure(g.name, 'pkg') + 2 * PACKAGE.tabPadX);
    const top = isBox ? PACKAGE.tabH + PACKAGE.margin : PACKAGE.margin;
    const pw = Math.max(out.w + 2 * PACKAGE.margin, isBox ? tabW + 24 : 0);
    const ph = out.h + top + PACKAGE.margin;
    inner.set(g.name, { out, offX: (pw - out.w) / 2, offY: top, tabW });
    outerNodes.push({ id: g.name, w: pw, h: ph });
  }
  const outer = runDagre(outerNodes, [...inter.values()], { dir, rankSep, nodeSep: nodeSep * 1.5 });
  const nodes: NodeBox[] = [];
  const boxById = new Map<string, NodeBox>();
  const packages: PackageBox[] = [];
  const layerOf = new Map(model.packages.map((p) => [p.name, p.layer]));
  for (const on of outerNodes) {
    const base = outer.pos.get(on.id) ?? { x: 0, y: 0 };
    const info = inner.get(on.id);
    if (!info) continue;
    if (on.id !== defaultPackage) {
      const layer = layerOf.get(on.id);
      packages.push({
        name: on.id,
        x: base.x,
        y: base.y,
        w: on.w,
        h: on.h,
        tabW: Math.min(info.tabW, on.w),
        ...(layer !== undefined ? { layer } : {}),
      });
    }
    const g = groups.get(on.id);
    for (const id of g?.ids ?? []) {
      const s = sizes.get(id);
      const p = info.out.pos.get(id);
      if (!s || !p) continue;
      const box: NodeBox = {
        id,
        x: base.x + info.offX + p.x,
        y: base.y + info.offY + p.y,
        w: s.w,
        h: s.h,
        packageName: s.pkg,
        geometry: s.geometry,
      };
      boxById.set(id, box);
    }
  }
  for (const t of model.types) {
    const b = boxById.get(t.id);
    if (b && !nodes.includes(b)) nodes.push(b);
  }
  const pkgBoxByName = new Map(packages.map((p) => [p.name, p]));
  // Carriles: cuántas aristas comparten cada par de paquetes (orden del modelo).
  const pairCount = new Map<string, number>();
  for (const r of model.relationships) {
    const a = sizes.get(r.source);
    const b = sizes.get(r.target);
    if (!a || !b || r.source === r.target || a.pkg === b.pkg) continue;
    const k = pairKey(a.pkg, b.pkg);
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  const pairSeen = new Map<string, number>();
  const edges: EdgePath[] = [];
  model.relationships.forEach((r, idx) => {
    const src = boxById.get(r.source);
    const tgt = boxById.get(r.target);
    if (!src || !tgt) return;
    let points: number[];
    if (src === tgt) {
      const x = src.x + src.w;
      const cy = src.y + src.h / 2;
      points = [x, cy - 10, x + 28, cy - 14, x + 28, cy + 14, x, cy + 10];
    } else if (src.packageName === tgt.packageName) {
      const pkg = src.packageName ?? defaultPackage;
      const info = inner.get(pkg);
      const base = outer.pos.get(pkg) ?? { x: 0, y: 0 };
      const raw = (info?.out.pts.get('e' + idx) ?? []).map((q) => ({
        x: q.x + base.x + (info?.offX ?? 0),
        y: q.y + base.y + (info?.offY ?? 0),
      }));
      const hier = r.type === 'EXTENDS' || r.type === 'IMPLEMENTS';
      if (hier) raw.reverse();
      const mid = raw.slice(1, -1);
      if (mid.length === 0) {
        points = portRoute(src, tgt, dir);
      } else {
        const first = mid[0] ?? { x: 0, y: 0 };
        const last = mid[mid.length - 1] ?? { x: 0, y: 0 };
        const [sx, sy] = clipToBox(src, first.x, first.y);
        const [ex, ey] = clipToBox(tgt, last.x, last.y);
        points = [sx, sy];
        for (const q of mid) points.push(q.x, q.y);
        points.push(ex, ey);
      }
    } else {
      const srcPkgName = src.packageName ?? defaultPackage;
      const tgtPkgName = tgt.packageName ?? defaultPackage;
      const srcBox = pkgBoxByName.get(srcPkgName);
      const tgtBox = pkgBoxByName.get(tgtPkgName);
      if (!srcBox || !tgtBox) {
        points = portRoute(src, tgt, dir);
      } else {
        const k = pairKey(srcPkgName, tgtPkgName);
        const lane = pairSeen.get(k) ?? 0;
        pairSeen.set(k, lane + 1);
        const lanes = pairCount.get(k) ?? 1;
        const obstacles: Rect[] = [];
        for (const p of packages) {
          if (p.name !== srcPkgName && p.name !== tgtPkgName) obstacles.push(p);
        }
        for (const n of nodes) {
          if (n.id !== src.id && n.id !== tgt.id) obstacles.push(n);
        }
        points = routeInterPackage(src, tgt, srcBox, tgtBox, lane, lanes, obstacles);
      }
    }
    edges.push({ source: r.source, target: r.target, type: r.type, points, ...(r.label ? { label: r.label } : {}) });
  });
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
  for (const b of nodes) add(b.x, b.y, b.w, b.h);
  for (const b of packages) add(b.x, b.y, b.w, b.h);
  for (const e of edges) {
    for (let i = 0; i + 1 < e.points.length; i += 2) add(e.points[i] ?? 0, e.points[i + 1] ?? 0, 0, 0);
  }
  return { nodes, edges, packages, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
