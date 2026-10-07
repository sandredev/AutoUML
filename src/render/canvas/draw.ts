// src/render/canvas/draw.ts — dibujo del diagrama en Canvas 2D (sin React).
import type { Category, DiagramModel, ParameterModel, RelType, TypeNode } from '../../core/model';
import type { EdgePath, LayoutResult, NodeBox, ViewState } from '../types';
import { queryEdges, queryNodes, type SpatialIndex } from './spatial';
import { visibleWorldRect } from './viewport';

export interface Theme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  cat: Record<Category, string>;
}

export interface DrawArgs {
  model: DiagramModel;
  layout: LayoutResult;
  index: SpatialIndex;
  view: ViewState;
  viewW: number;
  viewH: number;
  dpr: number;
  selectedId: string | null;
  theme: Theme;
}

export const LOD_BOXES = 0.15;
export const LOD_MEMBERS = 0.5;
export const LOD_DETAIL = 0.8;
const MAX_LOW_EDGES = 1500;
const HEADER_H = 28;
const ROW_H = 16;
const ARROW = 12;
const FONT_NAME = '600 12px system-ui, sans-serif';
const FONT_ROW = '11px ui-monospace, Consolas, monospace';
const FONT_SMALL = '10px system-ui, sans-serif';
const NO_DASH: number[] = [];

// ---------- cachés ----------
const typeMaps = new WeakMap<DiagramModel, Map<string, TypeNode>>();
function typesOf(model: DiagramModel): Map<string, TypeNode> {
  let m = typeMaps.get(model);
  if (!m) {
    m = new Map();
    for (const t of model.types) m.set(t.id, t);
    typeMaps.set(model, m);
  }
  return m;
}

function fmtParams(ps: ParameterModel[], abbr?: number): string {
  if (abbr !== undefined) return `…${abbr}`;
  return ps.map((p) => (p.name ? `${p.name}: ${p.type}` : p.type)).join(', ');
}
const rowCache = new WeakMap<TypeNode, string[]>();
function rowsOf(t: TypeNode): string[] {
  let rows = rowCache.get(t);
  if (!rows) {
    rows = [];
    for (const c of t.enumConstants) rows.push(c);
    for (const a of t.attributes) rows.push(`${a.visibility} ${a.name}${a.type ? `: ${a.type}` : ''}`);
    for (const c of t.constructors) rows.push(`${c.visibility} ${c.name}(${fmtParams(c.parameters, c.parametersAbbreviated)})`);
    for (const m of t.methods) rows.push(`${m.visibility} ${m.name}(${fmtParams(m.parameters, m.parametersAbbreviated)}): ${m.returnType}`);
    rowCache.set(t, rows);
  }
  return rows;
}
const stereoCache = new WeakMap<TypeNode, string>();
function stereoOf(t: TypeNode): string {
  let s = stereoCache.get(t);
  if (s === undefined) {
    s = t.stereotypes.length > 0 ? `«${t.stereotypes.join(', ')}»` : '';
    stereoCache.set(t, s);
  }
  return s;
}

const fitCache = new Map<string, string>();
/** Recorta con "…" para que quepa en maxW (unidades de mundo). Resultado cacheado. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  const k = `${ctx.font}|${Math.round(maxW)}|${text}`;
  const hit = fitCache.get(k);
  if (hit !== undefined) return hit;
  let out = text;
  if (ctx.measureText(text).width > maxW) {
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    out = lo > 0 ? `${text.slice(0, lo)}…` : '';
  }
  if (fitCache.size > 20000) fitCache.clear();
  fitCache.set(k, out);
  return out;
}

// ---------- aristas ----------
const isDashed = (t: RelType): boolean => t === 'IMPLEMENTS' || t === 'DEPENDENCY';
const isHollow = (t: RelType): boolean => t === 'EXTENDS' || t === 'IMPLEMENTS';

function tracePath(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  for (let k = 2; k + 1 < pts.length; k += 2) ctx.lineTo(pts[k] ?? 0, pts[k + 1] ?? 0);
}

function drawHead(ctx: CanvasRenderingContext2D, e: EdgePath, bg: string): void {
  const n = e.points.length;
  if (n < 4) return;
  const ex = e.points[n - 2] ?? 0, ey = e.points[n - 1] ?? 0;
  const px = e.points[n - 4] ?? 0, py = e.points[n - 3] ?? 0;
  const len = Math.hypot(ex - px, ey - py) || 1;
  const ux = (ex - px) / len, uy = (ey - py) / len;
  const bx = ex - ux * ARROW, by = ey - uy * ARROW;
  const nx = -uy * ARROW * 0.5, ny = ux * ARROW * 0.5;
  ctx.setLineDash(NO_DASH);
  ctx.beginPath();
  if (isHollow(e.type)) {
    ctx.moveTo(ex, ey); ctx.lineTo(bx + nx, by + ny); ctx.lineTo(bx - nx, by - ny); ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
  } else {
    ctx.moveTo(bx + nx, by + ny); ctx.lineTo(ex, ey); ctx.lineTo(bx - nx, by - ny);
  }
  ctx.stroke();
}

function drawLabel(ctx: CanvasRenderingContext2D, e: EdgePath, color: string): void {
  if (!e.label) return;
  const m = e.points.length / 2;
  const k = Math.max(0, Math.floor((m - 1) / 2));
  const x = ((e.points[k * 2] ?? 0) + (e.points[k * 2 + 2] ?? 0)) / 2;
  const y = ((e.points[k * 2 + 1] ?? 0) + (e.points[k * 2 + 3] ?? 0)) / 2;
  ctx.font = FONT_SMALL;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(fitText(ctx, e.label, 160), x, y - 2);
}

// ---------- nodos ----------
function drawCard(ctx: CanvasRenderingContext2D, b: NodeBox, t: TypeNode | undefined, a: DrawArgs, px: number): void {
  const { theme, view } = a;
  const color = theme.cat[t?.category ?? 'class'];
  const headH = Math.min(b.h, HEADER_H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.w, headH);
  ctx.globalAlpha = 1;
  ctx.fillRect(b.x, b.y, 4, b.h);
  ctx.lineWidth = px;
  ctx.strokeStyle = theme.border;
  ctx.strokeRect(b.x, b.y, b.w, b.h);

  const name = t?.name ?? b.label ?? b.id;
  const stereo = t && view.scale >= LOD_DETAIL ? stereoOf(t) : '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.fg;
  ctx.font = FONT_NAME;
  if (stereo) {
    ctx.fillText(fitText(ctx, name, b.w - 16), b.x + b.w / 2, b.y + 19);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = theme.muted;
    ctx.fillText(fitText(ctx, stereo, b.w - 16), b.x + b.w / 2, b.y + 7);
  } else if (b.subtitle) {
    ctx.fillText(fitText(ctx, name, b.w - 16), b.x + b.w / 2, b.y + 14);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = theme.muted;
    ctx.fillText(fitText(ctx, b.subtitle, b.w - 16), b.x + b.w / 2, b.y + 34);
  } else {
    ctx.fillText(fitText(ctx, name, b.w - 16), b.x + b.w / 2, b.y + headH / 2);
  }

  if (!t || view.scale < LOD_MEMBERS || a.model.summaryMode) return;
  const rows = rowsOf(t);
  const cap = Math.floor((b.h - HEADER_H) / ROW_H);
  if (cap <= 0 || rows.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y + HEADER_H);
  ctx.lineTo(b.x + b.w, b.y + HEADER_H);
  ctx.stroke();
  ctx.font = FONT_ROW;
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.fg;
  const overflow = rows.length > cap;
  const shown = overflow ? cap - 1 : rows.length;
  for (let r = 0; r < shown; r++) {
    ctx.fillText(fitText(ctx, rows[r] ?? '', b.w - 18), b.x + 10, b.y + HEADER_H + ROW_H * r + ROW_H / 2);
  }
  if (overflow) {
    ctx.fillStyle = theme.muted;
    ctx.fillText(`… +${rows.length - shown} más`, b.x + 10, b.y + HEADER_H + ROW_H * shown + ROW_H / 2);
  }
}

export function drawDiagram(ctx: CanvasRenderingContext2D, a: DrawArgs): void {
  const { layout, index, view, viewW, viewH, dpr, selectedId, theme } = a;
  const s = view.scale;
  const px = 1 / s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.tx, dpr * view.ty);
  const r = visibleWorldRect(view, viewW, viewH);
  const rx1 = r.x + r.w, ry1 = r.y + r.h;

  // Paquetes
  ctx.setLineDash(NO_DASH);
  ctx.lineWidth = px;
  ctx.strokeStyle = theme.border;
  for (const p of layout.packages) {
    if (p.x > rx1 || p.x + p.w < r.x || p.y > ry1 || p.y + p.h < r.y) continue;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
    if (s >= LOD_BOXES) {
      ctx.font = FONT_SMALL;
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, p.name, p.w - 16), p.x + 8, p.y + 12);
      ctx.textAlign = 'right';
      ctx.fillStyle = theme.accent;
      ctx.fillText('−', p.x + p.w - 8, p.y + 12);
    }
  }

  // Aristas
  const edges = queryEdges(index, r);
  if (s < LOD_BOXES) {
    if (edges.length <= MAX_LOW_EDGES) {
      ctx.beginPath();
      for (const i of edges) {
        const e = layout.edges[i];
        if (e) tracePath(ctx, e.points);
      }
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = px;
      ctx.stroke();
    }
  } else {
    const dash = [6 * px, 4 * px];
    const detail = s >= LOD_DETAIL;
    for (const i of edges) {
      const e = layout.edges[i];
      if (!e) continue;
      const hot = selectedId !== null && (e.source === selectedId || e.target === selectedId);
      ctx.strokeStyle = hot ? theme.accent : theme.muted;
      ctx.lineWidth = hot ? 2 * px : px;
      ctx.setLineDash(isDashed(e.type) ? dash : NO_DASH);
      ctx.beginPath();
      tracePath(ctx, e.points);
      ctx.stroke();
      if (detail) {
        drawHead(ctx, e, theme.bg);
        drawLabel(ctx, e, hot ? theme.accent : theme.muted);
      }
    }
    ctx.setLineDash(NO_DASH);
  }

  // Nodos
  const types = typesOf(a.model);
  let selBox: NodeBox | null = null;
  for (const i of queryNodes(index, r)) {
    const b = layout.nodes[i];
    if (!b) continue;
    const t = types.get(b.id);
    if (b.id === selectedId) selBox = b;
    if (s < LOD_BOXES) {
      ctx.fillStyle = theme.cat[t?.category ?? 'class'];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else {
      drawCard(ctx, b, t, a, px);
    }
  }
  if (selBox) {
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3 * px;
    ctx.strokeRect(selBox.x, selBox.y, selBox.w, selBox.h);
  }
}
