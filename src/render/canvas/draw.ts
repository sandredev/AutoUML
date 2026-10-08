// src/render/canvas/draw.ts — dibujo del diagrama en Canvas 2D estilo PlantUML (sin React).
import type { Category, DiagramModel, ParameterModel, RelType, TypeNode } from '../../core/model';
import type { EdgePath, LayoutResult, NodeBox, ViewState } from '../types';
import { CARD, DEFAULT_DETAIL, FONTS, PACKAGE } from '../style/contract';
import type { Badge, CardGeometry, CardRow, DetailOptions } from '../style/contract';
import { queryEdges, queryNodes, type SpatialIndex } from './spatial';
import { visibleWorldRect, type Rect } from './viewport';

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

// El diagrama siempre se dibuja con detalle completo, a cualquier zoom:
// lo de lejos es la misma imagen que de cerca, solo más pequeña.

// Papel PlantUML: el diagrama siempre se dibuja en claro, aunque la app esté en oscuro.
const paper = '#ffffff';
const ink = '#181818';
const cardFill = '#F1F1F1';
const pkgFill = '#FAFAFA';
const arrowLen = 11;
const noDash: number[] = [];
const fontFamily = FONTS.name.slice(FONTS.name.indexOf(' ') + 1);

function sized(px: number, italic: boolean, bold: boolean): string {
  return (italic ? 'italic ' : '') + (bold ? 'bold ' : '') + px.toFixed(2) + 'px ' + fontFamily;
}

const badgeOf: Record<Category, Badge> = {
  class: 'C', interface: 'I', enum: 'E', abstract: 'A', annotation: '@',
  record: 'R', sealed: 'S', external: 'X', undeclared: '?',
};
const badgeColors: Record<Category, string> = {
  class: '#ADD1B2', interface: '#B4A7E5', enum: '#EB937F', abstract: '#A9DCDF', annotation: '#E3664A',
  record: '#F7D58B', sealed: '#9FC8E8', external: '#D9D9D9', undeclared: '#E8E8E8',
};

export function badgeColor(c: Category): string {
  return badgeColors[c];
}

// ---------- contenido de tarjeta ----------
export interface DrawContent {
  name: string;
  stereo: string;
  badge: Badge;
  category: Category;
  italic: boolean;
  sections: CardRow[][];
  hidden: number;
}

function fmtParams(ps: ParameterModel[], abbr?: number): string {
  if (abbr !== undefined) return '…' + abbr;
  return ps.map((p) => (p.name ? p.name + ': ' + p.type : p.type)).join(', ');
}

export function cardContentOf(t: TypeNode, d: DetailOptions): DrawContent {
  const fields: CardRow[] = [];
  for (const c of t.enumConstants) fields.push({ visibility: '', text: c, isStatic: false, isAbstract: false });
  const attrNames = new Set<string>();
  for (const a of t.attributes) {
    attrNames.add(a.name.toLowerCase());
    fields.push({ visibility: a.visibility, text: a.visibility + a.name + (a.type ? ': ' + a.type : ''), isStatic: a.isStatic, isAbstract: false });
  }
  const ops: CardRow[] = [];
  if (!d.hideConstructors) {
    for (const c of t.constructors) {
      ops.push({ visibility: c.visibility, text: '«create» ' + c.visibility + c.name + '(' + fmtParams(c.parameters, c.parametersAbbreviated) + ')', isStatic: false, isAbstract: false });
    }
  }
  for (const m of t.methods) {
    if (d.hideAccessors) {
      const hit = /^(get|set|is)(.+)$/.exec(m.name);
      const prop = hit?.[2];
      if (prop !== undefined && attrNames.has(prop.toLowerCase())) continue;
    }
    ops.push({ visibility: m.visibility, text: m.visibility + m.name + '(' + fmtParams(m.parameters, m.parametersAbbreviated) + '): ' + m.returnType, isStatic: m.isStatic, isAbstract: m.isAbstract });
  }
  let sections = [fields, ops];
  if (d.hideEmptyCompartments) sections = sections.filter((s) => s.length > 0);
  let budget = Math.max(0, d.maxRows);
  let hidden = 0;
  sections = sections.map((s) => {
    const keep = s.slice(0, budget);
    hidden += s.length - keep.length;
    budget -= keep.length;
    return keep;
  });
  if (d.hideEmptyCompartments) sections = sections.filter((s) => s.length > 0);
  return {
    name: t.name,
    stereo: t.stereotypes.length > 0 ? '«' + t.stereotypes.join(', ') + '»' : '',
    badge: badgeOf[t.category],
    category: t.category,
    italic: t.declaredKind === 'interface' || t.isAbstract || t.category === 'abstract',
    sections,
    hidden,
  };
}

const contentCache = new WeakMap<TypeNode, DrawContent>();
function contentOf(t: TypeNode): DrawContent {
  let c = contentCache.get(t);
  if (!c) {
    c = cardContentOf(t, DEFAULT_DETAIL);
    contentCache.set(t, c);
  }
  return c;
}

export function fallbackGeometry(c: DrawContent): CardGeometry {
  return {
    headerH: c.stereo ? CARD.headerHStereo : CARD.headerH,
    sectionH: c.sections.map((s) => s.length * CARD.rowH + 2 * CARD.sectionPadY),
    hasMoreRow: c.hidden > 0,
  };
}

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

const fitCache = new Map<string, string>();
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  const k = ctx.font + '|' + Math.round(maxW * 4) + '|' + text;
  const hit = fitCache.get(k);
  if (hit !== undefined) return hit;
  let out = text;
  if (ctx.measureText(text).width > maxW) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    out = lo > 0 ? text.slice(0, lo) + '…' : '';
  }
  if (fitCache.size > 20000) fitCache.clear();
  fitCache.set(k, out);
  return out;
}

function intersects(x: number, y: number, w: number, h: number, r: Rect): boolean {
  return x <= r.x + r.w && x + w >= r.x && y <= r.y + r.h && y + h >= r.y;
}

// ---------- aristas ----------
const isDashed = (t: RelType): boolean => t === 'IMPLEMENTS' || t === 'DEPENDENCY';

// Curva suave por los puntos medios (similar a los splines de Graphviz).
function traceSmooth(ctx: CanvasRenderingContext2D, pts: number[]): void {
  const n = pts.length >> 1;
  if (n < 2) return;
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  if (n === 2) {
    ctx.lineTo(pts[2] ?? 0, pts[3] ?? 0);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2] ?? 0;
    const y = pts[i * 2 + 1] ?? 0;
    const nx = pts[i * 2 + 2] ?? 0;
    const ny = pts[i * 2 + 3] ?? 0;
    const last = i === n - 2;
    ctx.quadraticCurveTo(x, y, last ? nx : (x + nx) / 2, last ? ny : (y + ny) / 2);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, e: EdgePath, color: string, px: number): void {
  const n = e.points.length;
  if (n < 4) return;
  const ex = e.points[n - 2] ?? 0;
  const ey = e.points[n - 1] ?? 0;
  const qx = e.points[n - 4] ?? 0;
  const qy = e.points[n - 3] ?? 0;
  const len = Math.hypot(ex - qx, ey - qy) || 1;
  const ux = (ex - qx) / len;
  const uy = (ey - qy) / len;
  const hollow = e.type === 'EXTENDS' || e.type === 'IMPLEMENTS';
  const half = hollow ? arrowLen * 0.55 : arrowLen * 0.38;
  const bx = ex - ux * arrowLen;
  const by = ey - uy * arrowLen;
  const nx = -uy * half;
  const ny = ux * half;
  ctx.setLineDash(noDash);
  ctx.lineWidth = px;
  ctx.strokeStyle = color;
  ctx.beginPath();
  if (e.type === 'DEPENDENCY') {
    ctx.moveTo(bx + nx, by + ny);
    ctx.lineTo(ex, ey);
    ctx.lineTo(bx - nx, by - ny);
    ctx.stroke();
    return;
  }
  ctx.moveTo(ex, ey);
  ctx.lineTo(bx + nx, by + ny);
  ctx.lineTo(bx - nx, by - ny);
  ctx.closePath();
  ctx.fillStyle = hollow ? paper : color;
  ctx.fill();
  ctx.stroke();
}

function drawEdgeLabel(ctx: CanvasRenderingContext2D, e: EdgePath, color: string): void {
  if (!e.label) return;
  const m = e.points.length / 2;
  const k = Math.max(0, Math.floor((m - 1) / 2));
  const x = ((e.points[k * 2] ?? 0) + (e.points[k * 2 + 2] ?? 0)) / 2;
  const y = ((e.points[k * 2 + 1] ?? 0) + (e.points[k * 2 + 3] ?? 0)) / 2;
  ctx.font = FONTS.edge;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(fitText(ctx, e.label, 160), x, y - 2);
}

function drawEdges(ctx: CanvasRenderingContext2D, a: DrawArgs, r: Rect, px: number): void {
  const { layout, selectedId, theme } = a;
  const dash = [5 * px, 4 * px];
  for (const i of queryEdges(a.index, r)) {
    const e = layout.edges[i];
    if (!e) continue;
    const hot = selectedId !== null && (e.source === selectedId || e.target === selectedId);
    const color = hot ? theme.accent : ink;
    ctx.strokeStyle = color;
    ctx.lineWidth = hot ? 2 * px : px;
    ctx.setLineDash(isDashed(e.type) ? dash : noDash);
    ctx.beginPath();
    traceSmooth(ctx, e.points);
    ctx.stroke();
    drawHead(ctx, e, color, hot ? 2 * px : px);
    drawEdgeLabel(ctx, e, color);
  }
  ctx.setLineDash(noDash);
}

// ---------- paquetes ----------
function drawPackages(ctx: CanvasRenderingContext2D, a: DrawArgs, r: Rect, px: number): void {
  for (const p of a.layout.packages) {
    if (!intersects(p.x, p.y, p.w, p.h, r)) continue;
    ctx.font = sized(12, false, true);
    const tabW = Math.min(p.w, p.tabW ?? ctx.measureText(p.name).width + 2 * PACKAGE.tabPadX);
    const tabH = PACKAGE.tabH;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = ink;
    ctx.fillStyle = paper;
    ctx.fillRect(p.x, p.y + PACKAGE.tabH, p.w, p.h - PACKAGE.tabH);
    ctx.strokeRect(p.x, p.y + PACKAGE.tabH, p.w, p.h - PACKAGE.tabH);
    ctx.fillRect(p.x, p.y + PACKAGE.tabH - tabH, tabW, tabH);
    ctx.strokeRect(p.x, p.y + PACKAGE.tabH - tabH, tabW, tabH);
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, p.name, tabW - 2 * PACKAGE.tabPadX), p.x + PACKAGE.tabPadX, p.y + PACKAGE.tabH - tabH / 2);
  }
}

// ---------- tarjetas ----------
function drawAggregate(ctx: CanvasRenderingContext2D, b: NodeBox, a: DrawArgs, px: number): void {
  ctx.fillStyle = pkgFill;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = ink;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.font = sized(12, false, true);
  ctx.fillText(fitText(ctx, b.label ?? b.id, b.w - 16), b.x + b.w / 2, b.y + b.h * 0.35);
  if (b.subtitle) {
    ctx.font = FONTS.stereo;
    ctx.fillStyle = a.theme.muted;
    ctx.fillText(fitText(ctx, b.subtitle, b.w - 16), b.x + b.w / 2, b.y + b.h * 0.72);
  }
}

function drawCard(ctx: CanvasRenderingContext2D, b: NodeBox, t: TypeNode, a: DrawArgs, px: number): void {
  const c = contentOf(t);
  const g = b.geometry ?? fallbackGeometry(c);
  const headerH = Math.min(b.h, g.headerH);

  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, CARD.radius);
  ctx.fillStyle = cardFill;
  ctx.fill();
  ctx.lineWidth = px;
  ctx.strokeStyle = ink;
  ctx.stroke();

  // Cabecera: insignia + nombre centrado.
  const cy = b.y + headerH / 2;
  const bd = Math.min(CARD.badgeD, headerH - 4);
  const bcx = b.x + CARD.padX + bd / 2;
  ctx.beginPath();
  ctx.arc(bcx, cy, bd / 2, 0, Math.PI * 2);
  ctx.fillStyle = badgeColors[c.category];
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.font = sized(11, false, true);
  ctx.fillText(c.badge, bcx, cy + 0.5);
  const left = b.x + CARD.padX + bd + 4;
  const right = b.x + b.w - CARD.padX;
  const mid = (left + right) / 2;
  const showStereo = c.stereo !== '' && headerH >= CARD.headerHStereo;
  ctx.fillStyle = ink;
  if (showStereo) {
    ctx.font = FONTS.stereo;
    ctx.fillText(fitText(ctx, c.stereo, right - left), mid, b.y + 13);
    ctx.font = sized(13, c.italic, false);
    ctx.fillText(fitText(ctx, c.name, right - left), mid, b.y + headerH - 14);
  } else {
    ctx.font = sized(13, c.italic, false);
    ctx.fillText(fitText(ctx, c.name, right - left), mid, cy);
  }

  if (a.model.summaryMode) return;

  // Compartimentos.
  let y = b.y + headerH;
  const bottom = b.y + b.h;
  ctx.textAlign = 'left';
  for (let si = 0; si < c.sections.length; si++) {
    const rows = c.sections[si] ?? [];
    const h = g.sectionH[si] ?? rows.length * CARD.rowH + 2 * CARD.sectionPadY;
    if (y >= bottom - 1) break;
    ctx.beginPath();
    ctx.moveTo(b.x, y);
    ctx.lineTo(b.x + b.w, y);
    ctx.strokeStyle = ink;
    ctx.lineWidth = px;
    ctx.stroke();
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (!row) continue;
      const ry = y + CARD.sectionPadY + CARD.rowH * ri;
      if (ry + CARD.rowH > bottom + 0.5) break;
      ctx.font = row.isAbstract ? FONTS.rowItalic : FONTS.row;
      ctx.fillStyle = ink;
      const txt = fitText(ctx, row.text, b.w - 2 * CARD.padX);
      const tx = b.x + CARD.padX;
      const ty = ry + CARD.rowH / 2;
      ctx.fillText(txt, tx, ty);
      if (row.isStatic) {
        const w = ctx.measureText(txt).width;
        ctx.beginPath();
        ctx.moveTo(tx, ty + 6);
        ctx.lineTo(tx + w, ty + 6);
        ctx.stroke();
      }
    }
    y += h;
  }
  if (g.hasMoreRow && c.hidden > 0 && y + CARD.rowH <= bottom + 0.5) {
    ctx.font = FONTS.rowItalic;
    ctx.fillStyle = a.theme.muted;
    ctx.fillText('… +' + c.hidden + ' más', b.x + CARD.padX, y + CARD.rowH / 2);
  }
}

// ---------- orquestador ----------
function resetState(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 1;
  ctx.setLineDash(noDash);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export function drawDiagram(ctx: CanvasRenderingContext2D, a: DrawArgs): void {
  const { layout, view, viewW, viewH, dpr, selectedId, theme } = a;
  const s = view.scale;
  const px = 1 / s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resetState(ctx);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.tx, dpr * view.ty);
  const r = visibleWorldRect(view, viewW, viewH);

  drawPackages(ctx, a, r, px);
  drawEdges(ctx, a, r, px);

  const types = typesOf(a.model);
  let selBox: NodeBox | null = null;
  for (const i of queryNodes(a.index, r)) {
    const b = layout.nodes[i];
    if (!b) continue;
    if (b.id === selectedId) selBox = b;
    const t = types.get(b.id);
    if (t) drawCard(ctx, b, t, a, px);
    else drawAggregate(ctx, b, a, px);
  }
  if (selBox) {
    ctx.setLineDash(noDash);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.roundRect(selBox.x - 2 * px, selBox.y - 2 * px, selBox.w + 4 * px, selBox.h + 4 * px, CARD.radius);
    ctx.stroke();
  }
  resetState(ctx);
}
