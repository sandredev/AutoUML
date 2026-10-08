// src/render/canvas/draw.ts — dibujo del diagrama en Canvas 2D (sin React).
import type { Category, DiagramModel, RelType, TypeNode, Visibility } from '../../core/model';
import { COMP_PAD, compartmentH, compartmentRows, HEADER_H, memberSections, ROW_H, type MemberRow } from '../layout/members';
import type { EdgePath, LayoutResult, NodeBox, ViewState } from '../types';
import { CORNER_RADIUS, labelAnchor, lastSegment, roundedCorners, simplify } from './edgePath';
import { queryEdges, queryNodes, type SpatialIndex } from './spatial';
import { visibleWorldRect } from './viewport';

export interface Theme {
  /** Fondo del lienzo. */
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  cat: Record<Category, string>;
  /** Tarjetas estilo PlantUML: relleno, borde y texto. */
  card: string;
  cardBorder: string;
  cardFg: string;
  /** Color de las relaciones. */
  edge: string;
  /** Borde y nombre de los paquetes. */
  pkg: string;
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
/**
 * Hasta este número de tarjetas visibles se dibuja SIEMPRE todo el detalle (icono, nombre, estereotipo,
 * miembros, flechas y nombres de paquete), con cualquier zoom. Por encima se usan los niveles LOD_*
 * para que los diagramas enormes sigan siendo fluidos.
 */
export const FULL_DETAIL_MAX_NODES = 600;
/** Tamaño mínimo en pantalla (px) que se intenta dar a los nombres al alejar, sin salirse de la cabecera. */
const MIN_NAME_SCREEN_PX = 10;
const NAME_PX = 13;
const NAME_PX_MAX = 18;
const PKG_PX = 10;
const PKG_PX_MAX = 18;
const MAX_LOW_EDGES = 1500;
const ARROW = 12;
const CARD_RADIUS = 4;
const FONT_ROW = '12px system-ui, sans-serif';
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

// Puntos simplificados por arista (sin repetidos ni colineales); se recalculan si cambia el array.
const simpleCache = new WeakMap<number[], number[]>();
function simplePoints(e: EdgePath): number[] {
  let p = simpleCache.get(e.points);
  if (!p) {
    p = simplify(e.points);
    simpleCache.set(e.points, p);
  }
  return p;
}

/** Aristas ortogonales (ELK): tramos rectos con esquinas apenas redondeadas. Las demás, tal cual. */
function traceEdge(ctx: CanvasRenderingContext2D, e: EdgePath): void {
  if (e.routing !== 'orthogonal') {
    tracePath(ctx, e.points);
    return;
  }
  for (const o of roundedCorners(simplePoints(e), CORNER_RADIUS)) {
    if (o.op === 'move') ctx.moveTo(o.x, o.y);
    else if (o.op === 'line') ctx.lineTo(o.x, o.y);
    else ctx.arcTo(o.x1, o.y1, o.x2, o.y2, o.r);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, e: EdgePath, bg: string): void {
  // La flecha se alinea con el último tramo real (sin puntos repetidos al final).
  const seg = lastSegment(e.routing === 'orthogonal' ? simplePoints(e) : e.points);
  if (!seg) return;
  const [px, py, ex, ey] = seg;
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
  // Etiqueta en el centro del tramo más largo: en rutas ortogonales es el más legible.
  const at = labelAnchor(e.routing === 'orthogonal' ? simplePoints(e) : e.points);
  if (!at) return;
  const { x, y } = at;
  ctx.font = FONT_SMALL;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(fitText(ctx, e.label, 160), x, y - 2);
}

// ---------- iconos de categoría (estilo PlantUML) ----------
interface IconStyle { letter: string; fill: string; italic: boolean }

/** Círculo con letra y colores característicos de PlantUML para cada tipo de entidad. */
export function iconFor(t: TypeNode | undefined): IconStyle {
  if (!t) return { letter: 'C', fill: '#ADD1B2', italic: false };
  if (t.category === 'undeclared') return { letter: '?', fill: '#C8C8C8', italic: false };
  switch (t.declaredKind) {
    case 'interface':
      return { letter: 'I', fill: '#B4A7E5', italic: false };
    case 'enum':
      return { letter: 'E', fill: '#EB937F', italic: false };
    case 'record':
      return { letter: 'R', fill: '#F7D774', italic: false };
    case 'annotation':
      return { letter: '@', fill: '#E3664A', italic: false };
    case 'abstract':
      return { letter: 'A', fill: '#A9DCDF', italic: true };
    default:
      return t.isAbstract ? { letter: 'A', fill: '#A9DCDF', italic: true } : { letter: 'C', fill: '#ADD1B2', italic: false };
  }
}

/** Dibuja el icono centrado en (cx, cy) con radio r (unidades de mundo). */
function drawIcon(ctx: CanvasRenderingContext2D, t: TypeNode | undefined, cx: number, cy: number, r: number, px: number): void {
  const ic = iconFor(t);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ic.fill;
  ctx.fill();
  ctx.lineWidth = px;
  ctx.strokeStyle = '#181818';
  ctx.stroke();
  // Las entidades sealed llevan un anillo extra, como marca visual de «sealed».
  if (t?.isSealed) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.5 * px, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#181818';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${ic.italic ? 'italic ' : ''}700 ${Math.round(r * 1.3 * 10) / 10}px system-ui, sans-serif`;
  ctx.fillText(ic.letter, cx, cy + r * 0.08);
}

// ---------- iconos de visibilidad (estilo PlantUML) ----------
// Atributos: figura hueca. Métodos: figura rellena.
const VIS_STYLE: Record<Visibility, { stroke: string; fill: string }> = {
  '-': { stroke: '#C82930', fill: '#F24D5C' }, // private: cuadrado
  '#': { stroke: '#B38D22', fill: '#FFFF44' }, // protected: rombo
  '~': { stroke: '#1963A0', fill: '#4177AF' }, // package: triángulo
  '+': { stroke: '#038048', fill: '#84BE84' }, // public: círculo
};

function drawVisibility(ctx: CanvasRenderingContext2D, vis: Visibility, filled: boolean, cx: number, cy: number, px: number): void {
  const st = VIS_STYLE[vis];
  const r = 3.5;
  ctx.beginPath();
  if (vis === '-') {
    ctx.rect(cx - r, cy - r, 2 * r, 2 * r);
  } else if (vis === '#') {
    ctx.moveTo(cx, cy - r - 0.5); ctx.lineTo(cx + r + 0.5, cy); ctx.lineTo(cx, cy + r + 0.5); ctx.lineTo(cx - r - 0.5, cy); ctx.closePath();
  } else if (vis === '~') {
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  if (filled) {
    ctx.fillStyle = st.fill;
    ctx.fill();
  }
  ctx.lineWidth = Math.max(px, 1);
  ctx.strokeStyle = st.stroke;
  ctx.stroke();
}

/** Tamaño de fuente en mundo: crece al alejar para mantener ~min px en pantalla, con tope. */
function fontPx(base: number, max: number, scale: number): number {
  return Math.round(Math.min(max, Math.max(base, MIN_NAME_SCREEN_PX / scale)));
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------- nodos (tarjetas estilo PlantUML) ----------
function drawRow(ctx: CanvasRenderingContext2D, row: MemberRow, x: number, y: number, maxW: number, a: DrawArgs, px: number): void {
  const { theme } = a;
  let tx = x;
  if (row.vis) {
    drawVisibility(ctx, row.vis, row.kind === 'method', x + 4, y, px);
    tx = x + 13;
  }
  ctx.font = row.isAbstract ? `italic ${FONT_ROW}` : FONT_ROW;
  ctx.fillStyle = theme.cardFg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const text = fitText(ctx, row.text, maxW - (tx - x));
  ctx.fillText(text, tx, y);
  if (row.isStatic) {
    // Miembros estáticos subrayados, como en UML.
    const w = ctx.measureText(text).width;
    ctx.beginPath();
    ctx.moveTo(tx, y + 7);
    ctx.lineTo(tx + w, y + 7);
    ctx.lineWidth = px;
    ctx.strokeStyle = theme.cardFg;
    ctx.stroke();
  }
}

function drawCard(ctx: CanvasRenderingContext2D, b: NodeBox, t: TypeNode | undefined, a: DrawArgs, px: number, full: boolean): void {
  const { theme, view } = a;
  // Paquete contraído (sin tipo): tarjeta de resumen, sin icono ni compartimentos.
  const isPackageNode = !t && b.subtitle !== undefined;
  const headH = Math.min(b.h, isPackageNode ? b.h : HEADER_H);

  roundRectPath(ctx, b.x, b.y, b.w, b.h, CARD_RADIUS);
  ctx.fillStyle = theme.card;
  ctx.fill();
  ctx.lineWidth = px;
  ctx.strokeStyle = theme.cardBorder;
  ctx.stroke();

  const name = t?.name ?? b.label ?? b.id;
  const stereo = t && (full || view.scale >= LOD_DETAIL) ? stereoOf(t) : '';
  const italic = t?.isAbstract ? 'italic ' : '';
  const nameFont = (sz: number): string => `${italic}${sz}px system-ui, sans-serif`;
  const iconR = isPackageNode ? 0 : 8;
  const iconGap = isPackageNode ? 0 : iconR * 2 + 5;
  const avail = Math.max(0, b.w - 16 - iconGap);

  // Al alejar, el nombre crece (en mundo) para seguir legible, pero solo hasta donde cabe completo.
  let namePx = NAME_PX;
  ctx.font = nameFont(NAME_PX);
  const baseW = ctx.measureText(name).width;
  if (full) {
    const want = fontPx(NAME_PX, stereo ? 14 : NAME_PX_MAX, view.scale);
    if (want > NAME_PX && baseW > 0) namePx = Math.max(NAME_PX, Math.min(want, Math.floor((NAME_PX * avail) / baseW)));
  }
  ctx.font = nameFont(namePx);
  const shown = fitText(ctx, name, avail);
  const nameW = ctx.measureText(shown).width;

  // Icono + nombre centrados juntos, como en PlantUML.
  const nameY = isPackageNode ? b.y + 16 : stereo ? b.y + headH - 10 : b.y + headH / 2;
  const groupW = iconGap + nameW;
  const gx = Math.max(b.x + 8, b.x + (b.w - groupW) / 2);
  if (!isPackageNode) drawIcon(ctx, t, gx + iconR, nameY, iconR, px);
  ctx.fillStyle = theme.cardFg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, gx + iconGap, nameY);
  if (stereo) {
    ctx.font = `italic ${FONT_SMALL}`;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, stereo, b.w - 16), b.x + b.w / 2, b.y + 8);
  }
  if (isPackageNode && b.subtitle) {
    ctx.font = FONT_SMALL;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, b.subtitle, b.w - 16), b.x + b.w / 2, b.y + 34);
  }

  if (!t || a.model.summaryMode) return;

  // Compartimentos: atributos y métodos (siempre los dos, aunque estén vacíos, como PlantUML).
  const sec = memberSections(t);
  const rows = compartmentRows(sec);
  const y1 = b.y + HEADER_H;
  const y2 = y1 + compartmentH(rows.fields);
  ctx.lineWidth = px;
  ctx.strokeStyle = theme.cardBorder;
  ctx.beginPath();
  ctx.moveTo(b.x, y1); ctx.lineTo(b.x + b.w, y1);
  if (y2 < b.y + b.h - 0.5) { ctx.moveTo(b.x, y2); ctx.lineTo(b.x + b.w, y2); }
  ctx.stroke();

  if (!full && view.scale < LOD_MEMBERS) return;
  const maxW = b.w - 16;
  let y = y1 + COMP_PAD + ROW_H / 2;
  for (const r of sec.fields) { drawRow(ctx, r, b.x + 8, y, maxW, a, px); y += ROW_H; }
  y = y2 + COMP_PAD + ROW_H / 2;
  for (const r of sec.methods) { drawRow(ctx, r, b.x + 8, y, maxW, a, px); y += ROW_H; }
  if (sec.hidden > 0) {
    ctx.font = FONT_ROW;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'left';
    ctx.fillText(`… +${sec.hidden} más`, b.x + 8, y);
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
  const visibleNodes = queryNodes(index, r);
  // Con pocas tarjetas visibles se dibuja todo el detalle aunque el zoom sea pequeño (vista completa legible).
  const full = visibleNodes.length <= FULL_DETAIL_MAX_NODES;
  const boxesOnly = !full && s < LOD_BOXES;

  // Paquetes
  ctx.setLineDash(NO_DASH);
  ctx.lineWidth = px;
  ctx.strokeStyle = theme.pkg;
  for (const p of layout.packages) {
    if (p.x > rx1 || p.x + p.w < r.x || p.y > ry1 || p.y + p.h < r.y) continue;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
    if (!boxesOnly) {
      // Pestaña con el nombre del paquete, como en PlantUML.
      ctx.font = full ? `600 ${fontPx(PKG_PX, PKG_PX_MAX, s)}px system-ui, sans-serif` : `600 ${FONT_SMALL}`;
      const label = fitText(ctx, p.name, p.w - 36);
      const tabW = Math.min(p.w, ctx.measureText(label).width + 16);
      ctx.strokeRect(p.x, p.y, tabW, 22);
      ctx.fillStyle = theme.pkg;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p.x + 8, p.y + 11);
      ctx.textAlign = 'right';
      ctx.fillStyle = theme.accent;
      ctx.fillText('−', p.x + p.w - 8, p.y + 11);
    }
  }

  // Aristas
  const edges = queryEdges(index, r);
  if (boxesOnly) {
    if (edges.length <= MAX_LOW_EDGES) {
      ctx.beginPath();
      for (const i of edges) {
        const e = layout.edges[i];
        if (e) tracePath(ctx, e.points);
      }
      ctx.strokeStyle = theme.edge;
      ctx.lineWidth = px;
      ctx.stroke();
    }
  } else {
    const dash = [6 * px, 4 * px];
    const detail = full || s >= LOD_DETAIL;
    for (const i of edges) {
      const e = layout.edges[i];
      if (!e) continue;
      const hot = selectedId !== null && (e.source === selectedId || e.target === selectedId);
      ctx.strokeStyle = hot ? theme.accent : theme.edge;
      ctx.lineWidth = hot ? 2 * px : px;
      ctx.setLineDash(isDashed(e.type) ? dash : NO_DASH);
      ctx.beginPath();
      traceEdge(ctx, e);
      ctx.stroke();
      if (detail) {
        drawHead(ctx, e, theme.bg);
        drawLabel(ctx, e, hot ? theme.accent : theme.edge);
      }
    }
    ctx.setLineDash(NO_DASH);
  }

  // Nodos
  const types = typesOf(a.model);
  let selBox: NodeBox | null = null;
  for (const i of visibleNodes) {
    const b = layout.nodes[i];
    if (!b) continue;
    const t = types.get(b.id);
    if (b.id === selectedId) selBox = b;
    if (boxesOnly) {
      ctx.fillStyle = theme.cat[t?.category ?? 'class'];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else {
      drawCard(ctx, b, t, a, px, full);
    }
  }
  if (selBox) {
    roundRectPath(ctx, selBox.x, selBox.y, selBox.w, selBox.h, CARD_RADIUS);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3 * px;
    ctx.stroke();
  }
}
