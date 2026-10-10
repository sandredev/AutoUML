// src/render/canvas/draw.ts — dibujo del diagrama en Canvas 2D (sin React).
import type { Category, DiagramModel, TypeNode } from '../../core/model';
import type { Focus } from '../graph/focus';
import { DEFAULT_LABELS, fill, type ViewerLabels } from '../labels';
import { isPackageNode, packageNodeName } from '../layout/aggregate';
import type { CardDisplay } from '../style/contract';
import type { LayoutResult, NodeBox, ViewState } from '../types';
import { drawCard } from './card';
import { drawEdgeFull } from './edgeDraw';
import { drawNotes } from './notes';
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
  /** Relleno de los paquetes (skinparam PackageBackgroundColor); sin valor no se rellenan. */
  pkgBg?: string;
  /** Notas: papel, borde y texto. */
  noteBg: string;
  noteBorder: string;
  noteFg: string;
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
  /** Tarjeta bajo el puntero (borde resaltado). */
  hoverId?: string | null;
  /** Arista bajo el puntero (más gruesa y resaltada). */
  hoverEdge?: number | null;
  /** Si existe, todo lo que no esté en el foco se atenúa (DIM_ALPHA). */
  focus?: Focus | null;
  display?: CardDisplay | undefined;
  labels?: ViewerLabels;
  /** Paquete plegado → número de entidades. */
  packageCounts?: ReadonlyMap<string, number> | undefined;
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
const PKG_PX = 10;
const PKG_PX_MAX = 18;
const MAX_LOW_EDGES = 1500;
const SELECT_RADIUS = 4;
/** Opacidad de lo que queda fuera del foco al seleccionar una clase o una arista. */
export const DIM_ALPHA = 0.25;
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

function tracePath(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  for (let k = 2; k + 1 < pts.length; k += 2) ctx.lineTo(pts[k] ?? 0, pts[k + 1] ?? 0);
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

/** Tarjeta de paquete contraído (sin TypeNode): resumen con nombre y subtítulo. */
function drawPackageNode(ctx: CanvasRenderingContext2D, b: NodeBox, px: number, theme: Theme, subtitle?: string): void {
  roundRectPath(ctx, b.x, b.y, b.w, b.h, SELECT_RADIUS);
  ctx.fillStyle = theme.pkgBg ?? theme.card;
  ctx.fill();
  ctx.lineWidth = px;
  ctx.strokeStyle = theme.cardBorder;
  ctx.stroke();
  const name = b.label ?? (isPackageNode(b.id) ? packageNodeName(b.id) : b.id);
  ctx.fillStyle = theme.cardFg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(fitText(ctx, name, b.w - 16), b.x + b.w / 2, b.y + 16);
  const sub = subtitle ?? b.subtitle;
  if (sub) {
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = theme.muted;
    ctx.fillText(fitText(ctx, sub, b.w - 16), b.x + b.w / 2, b.y + 34);
  }
}

export function drawDiagram(ctx: CanvasRenderingContext2D, a: DrawArgs): void {
  const { layout, index, view, viewW, viewH, dpr, selectedId, theme } = a;
  const focus = a.focus ?? null;
  const labels = a.labels ?? DEFAULT_LABELS;
  const dim = (inFocus: boolean): number => (focus && !inFocus ? DIM_ALPHA : 1);
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
  const showMembers = full || s >= LOD_MEMBERS;
  const showDetail = full || s >= LOD_DETAIL;

  // Paquetes
  ctx.setLineDash(NO_DASH);
  ctx.lineWidth = px;
  ctx.globalAlpha = dim(false);
  for (const p of layout.packages) {
    if (p.x > rx1 || p.x + p.w < r.x || p.y > ry1 || p.y + p.h < r.y) continue;
    if (theme.pkgBg) {
      ctx.fillStyle = theme.pkgBg;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    ctx.strokeStyle = theme.pkg;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
    if (!boxesOnly) {
      // Pestaña con el nombre del paquete, como en PlantUML.
      ctx.font = full ? `600 ${fontPx(PKG_PX, PKG_PX_MAX, s)}px system-ui, sans-serif` : '600 10px system-ui, sans-serif';
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
  ctx.globalAlpha = 1;

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
    const hoverId = a.hoverId ?? null;
    for (const i of edges) {
      const e = layout.edges[i];
      if (!e) continue;
      const inFocus = focus?.edges.has(i) ?? false;
      const hovered = a.hoverEdge === i;
      ctx.globalAlpha = hovered ? 1 : dim(inFocus);
      const hot = inFocus || hovered || (hoverId !== null && (e.source === hoverId || e.target === hoverId));
      drawEdgeFull(
        ctx,
        e,
        e.rel !== undefined ? a.model.relationships[e.rel] : undefined,
        theme,
        { labels: showDetail, heads: showDetail, lineWidth: hovered ? 2 * px : px, highlighted: hot },
      );
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash(NO_DASH);
  }

  // Nodos
  const types = typesOf(a.model);
  let selBox: NodeBox | null = null;
  let hoverBox: NodeBox | null = null;
  for (const i of visibleNodes) {
    const b = layout.nodes[i];
    if (!b) continue;
    const isPkg = isPackageNode(b.id);
    const t = isPkg ? undefined : types.get(b.id);
    if (b.id === selectedId) selBox = b;
    if (b.id === a.hoverId) hoverBox = b;
    ctx.globalAlpha = dim(focus?.nodes.has(b.id) ?? false);
    if (boxesOnly) {
      ctx.fillStyle = theme.cat[t?.category ?? 'class'];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else if (!t) {
      const count = isPkg ? a.packageCounts?.get(packageNodeName(b.id)) : undefined;
      drawPackageNode(ctx, b, px, theme, count !== undefined ? fill(labels.collapsedSubtitle, { n: count }) : undefined);
    } else {
      drawCard(ctx, t, b, theme, {
        summary: a.model.summaryMode,
        members: showMembers,
        selected: t.id === selectedId,
        lineWidth: px,
        display: a.display,
        moreTemplate: labels.moreMembers,
      });
    }
  }
  ctx.globalAlpha = 1;

  // Notas (encima de las tarjetas, como en PlantUML)
  if (!boxesOnly && layout.notes && layout.notes.length > 0) {
    const byId = new Map<string, NodeBox>(layout.nodes.map((n) => [n.id, n]));
    ctx.globalAlpha = dim(false);
    drawNotes(ctx, layout.notes, byId, theme, px, r);
    ctx.globalAlpha = 1;
  }

  if (hoverBox && hoverBox !== selBox) {
    roundRectPath(ctx, hoverBox.x, hoverBox.y, hoverBox.w, hoverBox.h, SELECT_RADIUS);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2 * px;
    ctx.stroke();
  }
  if (selBox) {
    roundRectPath(ctx, selBox.x, selBox.y, selBox.w, selBox.h, SELECT_RADIUS);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3 * px;
    ctx.stroke();
  }
}
