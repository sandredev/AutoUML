// src/render/layout/layout.ts — motor de layout puro (sin DOM/React/Electron).
import * as dagreNs from '@dagrejs/dagre';
import type { DiagramModel, ParameterModel, TypeNode } from '../../core/model';
import type { EdgePath, LayoutOptions, LayoutResult, NodeBox, PackageBox } from '../types';

// Interop CJS/ESM: en Node el namespace puede traer solo `default`.
const dagre = (dagreNs as unknown as { default?: typeof dagreNs }).default ?? dagreNs;

export const HEADER_H = 28;
export const ROW_H = 16;
export const MAX_ROWS = 40;
export const SUMMARY_H = 32;
const MIN_W = 140;
const CHAR_W = 7.2;
const PAD_W = 24;
const PKG_MARGIN = 16;
const PKG_HEADER = 24;
const BIG_GRAPH = 400;
const DEFAULT_PACKAGE = '(default package)';

function fmtParams(ps: ParameterModel[], abbr?: number): string {
  if (abbr !== undefined) return `…${abbr}`;
  return ps.map((p) => (p.name ? `${p.name}: ${p.type}` : p.type)).join(', ');
}

/** Filas de miembros en el orden en que se dibujan. */
export function memberRows(node: TypeNode): string[] {
  const rows: string[] = [];
  for (const c of node.enumConstants) rows.push(c);
  for (const a of node.attributes) rows.push(`${a.visibility} ${a.name}${a.type ? `: ${a.type}` : ''}`);
  for (const c of node.constructors) rows.push(`${c.visibility} ${c.name}(${fmtParams(c.parameters, c.parametersAbbreviated)})`);
  for (const m of node.methods) {
    rows.push(`${m.visibility} ${m.name}(${fmtParams(m.parameters, m.parametersAbbreviated)}): ${m.returnType}`);
  }
  return rows;
}

export function measureNode(node: TypeNode, summary: boolean): { w: number; h: number } {
  let longest = node.name.length;
  if (node.stereotypes.length > 0) longest = Math.max(longest, `«${node.stereotypes.join(', ')}»`.length);
  if (summary) return { w: Math.max(MIN_W, CHAR_W * longest + PAD_W), h: SUMMARY_H };
  const rows = memberRows(node);
  const shown = Math.min(rows.length, MAX_ROWS);
  for (let i = 0; i < shown; i++) longest = Math.max(longest, (rows[i] ?? '').length);
  let visible = shown;
  if (rows.length > MAX_ROWS) {
    longest = Math.max(longest, `… +${rows.length - MAX_ROWS} más`.length);
    visible = MAX_ROWS + 1;
  }
  return { w: Math.max(MIN_W, CHAR_W * longest + PAD_W), h: HEADER_H + ROW_H * visible };
}

/** Punto del borde de la caja en la dirección (px,py) desde su centro. */
function clipToBox(b: NodeBox, px: number, py: number): [number, number] {
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

const fin = (n: number): boolean => Number.isFinite(n);

export function computeLayout(model: DiagramModel, opts?: LayoutOptions): LayoutResult {
  const summary = opts?.summary ?? model.summaryMode;
  const rankSep = opts?.rankSep ?? 80;
  const nodeSep = opts?.nodeSep ?? 40;

  if (model.types.length === 0) {
    return { nodes: [], edges: [], packages: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  const cfg: Record<string, string | number> = {
    rankdir: 'TB',
    ranksep: rankSep,
    nodesep: nodeSep,
    edgesep: 10,
    marginx: 0,
    marginy: 0,
  };
  if (model.types.length > BIG_GRAPH) {
    cfg.ranker = 'longest-path';
    cfg.acyclicer = 'greedy';
  }
  g.setGraph(cfg as Parameters<typeof g.setGraph>[0]);
  g.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { w: number; h: number }>();
  for (const t of model.types) {
    if (sizes.has(t.id)) continue;
    const s = measureNode(t, summary);
    sizes.set(t.id, s);
    g.setNode(t.id, { width: s.w, height: s.h });
  }

  interface Pending { idx: number; v: string; w: string; reversed: boolean; self: boolean }
  const pending: Pending[] = [];
  model.relationships.forEach((r, idx) => {
    if (!sizes.has(r.source) || !sizes.has(r.target)) return;
    if (r.source === r.target) {
      pending.push({ idx, v: r.source, w: r.target, reversed: false, self: true });
      return;
    }
    // Herencia: dagre recibe padre -> hijo para que el padre quede arriba.
    const hier = r.type === 'EXTENDS' || r.type === 'IMPLEMENTS';
    const v = hier ? r.target : r.source;
    const w = hier ? r.source : r.target;
    g.setEdge(v, w, {}, `e${idx}`);
    pending.push({ idx, v, w, reversed: hier, self: false });
  });

  dagre.layout(g);

  const nodes: NodeBox[] = [];
  const boxById = new Map<string, NodeBox>();
  for (const [id, s] of sizes) {
    const n = g.node(id) as unknown as { x: number; y: number } | undefined;
    const cx = n && fin(n.x) ? n.x : 0;
    const cy = n && fin(n.y) ? n.y : 0;
    const box: NodeBox = { id, x: cx - s.w / 2, y: cy - s.h / 2, w: s.w, h: s.h };
    nodes.push(box);
    boxById.set(id, box);
  }

  const edges: EdgePath[] = [];
  for (const p of pending) {
    const r = model.relationships[p.idx];
    if (!r) continue;
    const src = boxById.get(r.source);
    const tgt = boxById.get(r.target);
    if (!src || !tgt) continue;
    let points: number[];
    if (p.self) {
      const x = src.x + src.w;
      const cy = src.y + src.h / 2;
      points = [x, cy - 8, x + 24, cy - 8, x + 24, cy + 8, x, cy + 8];
    } else {
      const e = g.edge({ v: p.v, w: p.w, name: `e${p.idx}` }) as unknown as { points?: { x: number; y: number }[] } | undefined;
      const raw = (e?.points ?? []).filter((q) => fin(q.x) && fin(q.y));
      if (p.reversed) raw.reverse();
      const inner = raw.slice(1, -1);
      const first = inner[0];
      const last = inner[inner.length - 1];
      const [sx, sy] = clipToBox(src, first ? first.x : tgt.x + tgt.w / 2, first ? first.y : tgt.y + tgt.h / 2);
      const [ex, ey] = clipToBox(tgt, last ? last.x : src.x + src.w / 2, last ? last.y : src.y + src.h / 2);
      points = [sx, sy];
      for (const q of inner) points.push(q.x, q.y);
      points.push(ex, ey);
    }
    edges.push({ source: r.source, target: r.target, type: r.type, points, ...(r.label ? { label: r.label } : {}) });
  }

  const packages: PackageBox[] = [];
  for (const pk of model.packages) {
    if (pk.name === DEFAULT_PACKAGE) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of pk.typeIds) {
      const b = boxById.get(id);
      if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    if (!fin(x0)) continue;
    packages.push({
      name: pk.name,
      x: x0 - PKG_MARGIN,
      y: y0 - PKG_MARGIN - PKG_HEADER,
      w: x1 - x0 + 2 * PKG_MARGIN,
      h: y1 - y0 + 2 * PKG_MARGIN + PKG_HEADER,
      ...(pk.layer !== undefined ? { layer: pk.layer } : {}),
    });
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, w = 0, h = 0): void => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  };
  for (const b of nodes) add(b.x, b.y, b.w, b.h);
  for (const b of packages) add(b.x, b.y, b.w, b.h);
  for (const e of edges) for (let i = 0; i + 1 < e.points.length; i += 2) add(e.points[i] ?? 0, e.points[i + 1] ?? 0);

  return { nodes, edges, packages, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
