// src/presentation/diagram/canvas/draw.ts — dibujo del diagrama en Canvas 2D (sin React).
import type { Category, DiagramModel, TypeNode } from '../../../domain/diagram/model';
import { FALLBACK_HEAT, FALLBACK_MARK_CYCLE, FALLBACK_MARK_VIOLATION, markOfEdge, type AnalysisOverlay } from '../analysis/overlay';
import type { Focus } from '../graph/focus';
import { DEFAULT_LABELS, fill, type ViewerLabels } from '../labels';
import { isPackageNode, packageNodeName } from '../layout/aggregate';
import { makeMeasurer } from '../layout/cardModel';
import { blockAlpha, semanticOf, type SemanticAggregate } from '../semantic/aggregatePackages';
import type { CardDisplay, TextMeasurer } from '../style/contract';
import type { LayoutResult, NodeBox, ViewState } from '../types';
import { drawCard } from './card';
import type { FrameFx } from './tween';
import { drawEdgeFull } from './edgeDraw';
import { type EdgeLabelSpots, placeEdgeLabels } from '../edgeLabels';
import { firstSegment, headGeometry, headsOf, lastSegment, simplify } from './edgePath';
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
  /** Borde de los paquetes (≥ 3:1 sobre el lienzo). */
  pkg: string;
  /** Prefijo del nombre del paquete (gris legible); el último segmento va en `fg`. Sin él, `pkg`. */
  pkgFg?: string;
  /** Relleno de los paquetes (skinparam PackageBackgroundColor); sin valor no se rellenan. */
  pkgBg?: string;
  /** Notas: papel, borde y texto. */
  noteBg: string;
  noteBorder: string;
  noteFg: string;
  /** Capa de análisis (T9): rampa de calor (5 pasos, de poco a mucho) y marcas de aristas. Opcionales. */
  heat?: readonly string[];
  markCycle?: string;
  markViolation?: string;
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
  /** Selección múltiple (marco, Ctrl+clic): también llevan anillo. */
  selectedIds?: ReadonlySet<string>;
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
  /** Sin relleno de fondo (exportación con transparencia). */
  transparent?: boolean;
  /** Opacidad y escala por elemento durante una transición de layout (T6). Sin valor: todo normal. */
  fx?: FrameFx | undefined;
  /** Tarjetas que están saliendo y ya no existen en `model`: se dibujan con el modelo anterior. */
  extraTypes?: ReadonlyMap<string, TypeNode> | undefined;
  /** Halo de lo que cambió al recargar: id de tarjeta → intensidad 0‒1. */
  halo?: ReadonlyMap<string, number> | undefined;
  /** Capa de análisis (T9): solo dibujo, no cambia el layout. Sin valor: el diagrama de siempre. */
  analysis?: AnalysisOverlay | null | undefined;
  /**
   * Layout del que sale la agregación semántica. Durante una transición `layout` es una mezcla nueva en cada
   * fotograma (la memoización por identidad no valdría): se pasa el layout estable de destino.
   */
  semanticLayout?: LayoutResult | undefined;
}

/** Por encima de estas aristas las etiquetas van al centro de su tramo más largo (colocarlas cuesta O(n²)). */
const LABEL_PLACE_MAX_EDGES = 150;
const labelSpotCache = new WeakMap<LayoutResult, Map<number, EdgeLabelSpots>>();
let labelMeasurer: TextMeasurer | null = null;

/**
 * Etiquetas de relación colocadas sin pisar tarjetas ni otras etiquetas (misma colocación que el SVG).
 * Mide con un medidor propio (no con el contexto del dibujo): así el dibujo no cambia según haya caché o no.
 */
function edgeLabelSpots(layout: LayoutResult, model: DiagramModel): Map<number, EdgeLabelSpots> | null {
  if (layout.edges.length > LABEL_PLACE_MAX_EDGES) return null;
  const hit = labelSpotCache.get(layout);
  if (hit) return hit;
  labelMeasurer ??= makeMeasurer();
  const measure = labelMeasurer;
  const spots = placeEdgeLabels(
    layout,
    (e) => {
      const rel = e.rel !== undefined ? model.relationships[e.rel] : undefined;
      const text = rel?.label ?? e.label;
      const pts = simplify(e.points);
      const heads = headsOf(rel ?? { type: e.type });
      const first = firstSegment(pts);
      const last = lastSegment(pts);
      return {
        label: !text ? undefined : rel?.labelArrow === 'forward' ? text + ' ▶' : rel?.labelArrow === 'backward' ? '◀ ' + text : text,
        source: rel?.sourceLabel,
        target: rel?.targetLabel,
        sourceInset: first ? headGeometry(heads.source, ...first).inset : 0,
        targetInset: last ? headGeometry(heads.target, ...last).inset : 0,
      };
    },
    (t) => measure(t, 'edge'),
    (n) => measure(n, 'pkg'),
  );
  labelSpotCache.set(layout, spots);
  return spots;
}

/** Tema claro fijo para exportar (mismos valores que los fallbacks de readTheme). */
export const LIGHT_THEME: Theme = {
  bg: '#ffffff',
  fg: '#1e2033',
  muted: '#555b70',
  border: '#d9dce5',
  accent: '#b8360f',
  cat: {
    sealed: '#683fb4',
    abstract: '#5d46b1',
    interface: '#0a56b1',
    enum: '#15662c',
    record: '#0b6262',
    annotation: '#973d00',
    class: '#545a69',
    external: '#755300',
    undeclared: '#a62049',
  },
  card: '#ffffff',
  cardBorder: '#454a62',
  cardFg: '#1e2033',
  edge: '#4f546c',
  pkg: '#7d8297',
  pkgFg: '#555b70',
  noteBg: '#FEFECE',
  noteBorder: '#454a62',
  noteFg: '#1e2033',
};

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
const PKG_PX = 12;
const PKG_PX_MAX = 18;
const MAX_LOW_EDGES = 1500;
const SELECT_RADIUS = 4;
/** Opacidad de lo que queda fuera del foco al seleccionar una clase o una arista. */
export const DIM_ALPHA = 0.25;
const NO_DASH: number[] = [];
/** Zoom semántico: tamaño en pantalla (px) del nombre y del "×n" de cada bloque, y de la punta de sus aristas. */
const BLOCK_NAME_PX = 13;
const BLOCK_COUNT_PX = 11;
const BLOCK_HEAD_PX = 7;

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

const PKG_RADIUS = 6;
const UI_SANS = '"Segoe UI Variable Text", "Segoe UI", system-ui, Ubuntu, Cantarell, "DejaVu Sans", sans-serif';

/**
 * Nombre de paquete: prefijo en gris y último segmento en negrita ("domain.model." + "core"), como en la lista
 * de entidades. Si no cabe, se recorta entero con "…" (el nombre completo está en el tooltip y en la lista).
 */
function drawPackageLabel(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, maxW: number, size: number, theme: Theme): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const dot = name.lastIndexOf('.');
  const prefix = dot < 0 ? '' : name.slice(0, dot + 1);
  const leaf = dot < 0 ? name : name.slice(dot + 1);
  const muted = theme.pkgFg ?? theme.pkg;
  ctx.font = `${size}px ${UI_SANS}`;
  const pw = ctx.measureText(prefix).width;
  ctx.font = `600 ${size}px ${UI_SANS}`;
  const lw = ctx.measureText(leaf).width;
  if (pw + lw <= maxW) {
    if (prefix) {
      ctx.font = `${size}px ${UI_SANS}`;
      ctx.fillStyle = muted;
      ctx.fillText(prefix, x, y);
    }
    ctx.font = `600 ${size}px ${UI_SANS}`;
    ctx.fillStyle = theme.fg;
    ctx.fillText(leaf, x + pw, y);
    return;
  }
  ctx.font = `600 ${size}px ${UI_SANS}`;
  ctx.fillStyle = theme.fg;
  ctx.fillText(fitText(ctx, name, maxW), x, y);
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
  ctx.font = `600 13px ${UI_SANS}`;
  ctx.fillText(fitText(ctx, name, b.w - 16), b.x + b.w / 2, b.y + 16);
  const sub = subtitle ?? b.subtitle;
  if (sub) {
    ctx.font = `12px ${UI_SANS}`;
    ctx.fillStyle = theme.muted;
    ctx.fillText(fitText(ctx, sub, b.w - 16), b.x + b.w / 2, b.y + 34);
  }
}

/** Punto donde el rayo desde el centro de `b` en dirección (dx, dy) sale de la caja (|d| = 1). */
function exitPoint(b: { x: number; y: number; w: number; h: number }, dx: number, dy: number): [number, number] {
  const hw = b.w / 2, hh = b.h / 2;
  const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return [b.x + hw + dx * t, b.y + hh + dy * t];
}

/**
 * Capa de zoom semántico (T10.5): aristas agregadas (grosor según n, con punta) y un bloque "nombre ×n" por paquete.
 * Solo dibujo sobre la agregación memoizada del layout; `alpha` es la de los bloques (fundido con las tarjetas).
 */
function drawSemantic(
  ctx: CanvasRenderingContext2D,
  sem: SemanticAggregate,
  alpha: number,
  a: DrawArgs,
  r: { x: number; y: number; w: number; h: number },
  dimOf: (name: string) => number,
): void {
  const { theme } = a;
  const s = a.view.scale;
  const px = 1 / s;
  const rx1 = r.x + r.w, ry1 = r.y + r.h;
  const byName = new Map(sem.packages.map((p) => [p.name, p.bounds]));
  const fxOf = (name: string): number => a.fx?.packages.get(name) ?? 1;

  // Aristas: de borde a borde, desplazadas a su derecha para que a→b y b→a no se pisen.
  ctx.setLineDash(NO_DASH);
  ctx.strokeStyle = theme.edge;
  ctx.fillStyle = theme.edge;
  for (const e of sem.edges) {
    const sb = byName.get(e.source), tb = byName.get(e.target);
    if (!sb || !tb) continue;
    const scx = sb.x + sb.w / 2, scy = sb.y + sb.h / 2;
    const dx0 = tb.x + tb.w / 2 - scx, dy0 = tb.y + tb.h / 2 - scy;
    const len = Math.hypot(dx0, dy0);
    if (len === 0) continue;
    const dx = dx0 / len, dy = dy0 / len;
    const off = (e.width / 2 + 1) * px;
    const [x0, y0] = exitPoint(sb, dx, dy);
    const [x1, y1] = exitPoint(tb, -dx, -dy);
    const ox = -dy * off, oy = dx * off;
    const ax = x0 + ox, ay = y0 + oy, bx = x1 + ox, by = y1 + oy;
    if (Math.max(ax, bx) < r.x || Math.min(ax, bx) > rx1 || Math.max(ay, by) < r.y || Math.min(ay, by) > ry1) continue;
    ctx.globalAlpha = alpha * Math.min(dimOf(e.source), dimOf(e.target)) * Math.min(fxOf(e.source), fxOf(e.target));
    const head = (BLOCK_HEAD_PX + e.width) * px;
    ctx.lineWidth = e.width * px;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx - dx * head, by - dy * head);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - dx * head - dy * head * 0.5, by - dy * head + dx * head * 0.5);
    ctx.lineTo(bx - dx * head + dy * head * 0.5, by - dy * head - dx * head * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  // Bloques: caja del paquete rellena (tapa las tarjetas que se desvanecen debajo), nombre y ×n a tamaño fijo en pantalla.
  const namePx = Math.round(BLOCK_NAME_PX * px);
  const countPx = Math.round(BLOCK_COUNT_PX * px);
  for (const p of sem.packages) {
    const b = p.bounds;
    if (b.x > rx1 || b.x + b.w < r.x || b.y > ry1 || b.y + b.h < r.y) continue;
    ctx.globalAlpha = alpha * dimOf(p.name) * fxOf(p.name);
    roundRectPath(ctx, b.x, b.y, b.w, b.h, SELECT_RADIUS * px);
    ctx.fillStyle = theme.pkgBg ?? theme.card;
    ctx.fill();
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = theme.pkg;
    ctx.stroke();
    const maxW = b.w - 16 * px;
    if (maxW * s < 24) continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const twoLines = b.h * s >= (BLOCK_NAME_PX + BLOCK_COUNT_PX) * 1.6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${namePx}px system-ui, sans-serif`;
    ctx.fillStyle = theme.cardFg;
    ctx.fillText(fitText(ctx, twoLines ? p.name : `${p.name} ×${p.classCount}`, maxW), cx, twoLines ? cy - countPx * 0.6 : cy);
    if (twoLines) {
      ctx.font = `${countPx}px system-ui, sans-serif`;
      ctx.fillStyle = theme.muted;
      ctx.fillText(fitText(ctx, `×${p.classCount}`, maxW), cx, cy + namePx * 0.6);
    }
  }
  ctx.globalAlpha = 1;
}

export function drawDiagram(ctx: CanvasRenderingContext2D, a: DrawArgs): void {
  const { layout, index, view, viewW, viewH, dpr, selectedId, selectedIds, theme } = a;
  const focus = a.focus ?? null;
  const labels = a.labels ?? DEFAULT_LABELS;
  const dim = (inFocus: boolean): number => (focus && !inFocus ? DIM_ALPHA : 1);
  const s = view.scale;
  const px = 1 / s;
  const analysis = a.analysis ?? null;
  const heatRamp = theme.heat ?? FALLBACK_HEAT;
  const markColor = (m: 'cycle' | 'violation'): string =>
    m === 'cycle' ? theme.markCycle ?? FALLBACK_MARK_CYCLE : theme.markViolation ?? FALLBACK_MARK_VIOLATION;
  const heatOf = (id: string): string | undefined => {
    const bin = analysis?.heat?.get(id);
    return bin === undefined ? undefined : heatRamp[bin];
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  if (!a.transparent) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, viewW, viewH);
  } else {
    ctx.clearRect(0, 0, viewW, viewH);
  }
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.tx, dpr * view.ty);
  const r = visibleWorldRect(view, viewW, viewH);
  const rx1 = r.x + r.w, ry1 = r.y + r.h;
  const visibleNodes = queryNodes(index, r);
  // Con pocas tarjetas visibles se dibuja todo el detalle aunque el zoom sea pequeño (vista completa legible).
  const full = visibleNodes.length <= FULL_DETAIL_MAX_NODES;
  const boxesOnly = !full && s < LOD_BOXES;
  const showMembers = full || s >= LOD_MEMBERS;
  const showDetail = full || s >= LOD_DETAIL;
  // Zoom semántico (T10.5): en diagramas grandes, al alejar cada paquete se funde en un bloque "nombre ×n".
  // Depende solo del total de nodos y del zoom (fundido continuo); la agregación se memoiza por layout.
  const sem = layout.nodes.length > FULL_DETAIL_MAX_NODES && layout.packages.length > 0 ? semanticOf(a.semanticLayout ?? layout) : null;
  const ba = sem && sem.packages.length > 0 ? blockAlpha(s) : 0;
  /** Opacidad de lo que el bloque sustituye: tarjetas empaquetadas, sus aristas, marcos de paquete y notas. */
  const ca = 1 - ba;
  const packed = (id: string): boolean => ba > 0 && sem!.owners.has(id);
  const edgeAlpha = (source: string, target: string): number => (packed(source) && packed(target) ? ca : 1);

  // Paquetes
  ctx.setLineDash(NO_DASH);
  ctx.lineWidth = px;
  ctx.globalAlpha = dim(false);
  for (const p of ca > 0 ? layout.packages : []) {
    if (p.x > rx1 || p.x + p.w < r.x || p.y > ry1 || p.y + p.h < r.y) continue;
    ctx.globalAlpha = dim(false) * (a.fx?.packages.get(p.name) ?? 1) * ca;
    if (theme.pkgBg) {
      ctx.fillStyle = theme.pkgBg;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    // T11: marco sólido de 1 px con --uml-pkg (≥ 3:1) y radio 6; el nombre va dentro, sin pestaña.
    ctx.strokeStyle = theme.pkg;
    roundRectPath(ctx, p.x, p.y, p.w, p.h, PKG_RADIUS);
    ctx.stroke();
    if (!boxesOnly) {
      const size = full ? fontPx(PKG_PX, PKG_PX_MAX, s) : PKG_PX;
      drawPackageLabel(ctx, p.name, p.x + 12, p.y + 11, p.w - 36, size, theme);
      ctx.textAlign = 'right';
      ctx.fillStyle = theme.accent;
      ctx.font = `600 ${size}px ${UI_SANS}`;
      ctx.fillText('−', p.x + p.w - 8, p.y + 11);
    }
  }
  ctx.globalAlpha = 1;

  // Aristas
  const edges = queryEdges(index, r);
  if (boxesOnly) {
    if (edges.length <= MAX_LOW_EDGES) {
      // Sin zoom semántico, un solo grupo opaco; con él, las aristas entre empaquetadas se funden aparte.
      for (const alpha of ba > 0 ? [1, ca] : [1]) {
        if (alpha <= 0) continue;
        const inGroup = (i: number): boolean => ba === 0 || edgeAlpha(layout.edges[i]!.source, layout.edges[i]!.target) === alpha;
        if (alpha !== 1) ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (const i of edges) {
          const e = layout.edges[i];
          if (e && inGroup(i)) tracePath(ctx, e.points);
        }
        ctx.strokeStyle = theme.edge;
        ctx.lineWidth = px;
        ctx.stroke();
        // Capa de análisis: las aristas marcadas, encima y en su color (sin el detalle del trazo a este zoom).
        if (analysis) {
          for (const m of ['violation', 'cycle'] as const) {
            ctx.beginPath();
            let any = false;
            for (const i of edges) {
              const e = layout.edges[i];
              if (e && inGroup(i) && markOfEdge(analysis, a.model, e) === m) {
                tracePath(ctx, e.points);
                any = true;
              }
            }
            if (!any) continue;
            ctx.strokeStyle = markColor(m);
            ctx.lineWidth = 3 * px;
            ctx.stroke();
          }
        }
        if (alpha !== 1) ctx.globalAlpha = 1;
      }
    }
  } else {
    const hoverId = a.hoverId ?? null;
    const spots = showDetail ? edgeLabelSpots(layout, a.model) : null;
    for (const i of edges) {
      const e = layout.edges[i];
      if (!e) continue;
      const fade = edgeAlpha(e.source, e.target);
      if (fade <= 0) continue;
      const inFocus = focus?.edges.has(i) ?? false;
      const hovered = a.hoverEdge === i;
      ctx.globalAlpha = (hovered ? 1 : dim(inFocus)) * (a.fx?.edges.get(i) ?? 1) * fade;
      const hot = inFocus || hovered || (hoverId !== null && (e.source === hoverId || e.target === hoverId));
      const mark = analysis ? markOfEdge(analysis, a.model, e) : null;
      drawEdgeFull(
        ctx,
        e,
        e.rel !== undefined ? a.model.relationships[e.rel] : undefined,
        theme,
        {
          labels: showDetail,
          heads: showDetail,
          lineWidth: hovered ? 2 * px : px,
          highlighted: hot,
          ...(mark ? { mark, markColor: markColor(mark) } : {}),
          labelAt: spots?.get(i),
        },
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
    if (b.id === selectedId || (selectedIds?.has(b.id) ?? false)) selBox = b;
    const fade = packed(b.id) ? ca : 1;
    if (fade <= 0) continue;
    const isPkg = isPackageNode(b.id);
    const t = isPkg ? undefined : (types.get(b.id) ?? a.extraTypes?.get(b.id));
    if (b.id === a.hoverId) hoverBox = b;
    const nfx = a.fx?.nodes.get(b.id);
    ctx.globalAlpha = dim(focus?.nodes.has(b.id) ?? false) * (nfx?.alpha ?? 1) * fade;
    // Escala desde el centro (entrada de tarjetas nuevas): solo cuando no es 1.
    const scaled = nfx !== undefined && nfx.scale !== 1;
    if (scaled) {
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.scale(nfx.scale, nfx.scale);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    }
    if (boxesOnly) {
      ctx.fillStyle = (t && heatOf(t.id)) ?? theme.cat[t?.category ?? 'class'];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else if (!t) {
      const count = isPkg ? a.packageCounts?.get(packageNodeName(b.id)) : undefined;
      drawPackageNode(ctx, b, px, theme, count !== undefined ? fill(labels.collapsedSubtitle, { n: count }) : undefined);
    } else {
      drawCard(ctx, t, b, theme, {
        summary: a.model.summaryMode,
        members: showMembers,
        selected: t.id === selectedId || (selectedIds?.has(t.id) ?? false),
        lineWidth: px,
        display: a.display,
        moreTemplate: labels.moreMembers,
        heat: heatOf(t.id),
      });
    }
    if (scaled) ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Zoom semántico: aristas agregadas y bloques encima de las tarjetas que se desvanecen.
  if (sem && ba > 0) {
    let focusedBlocks: Set<string> | null = null;
    if (focus) {
      focusedBlocks = new Set();
      for (const id of focus.nodes) {
        const owner = sem.owners.get(id);
        if (owner !== undefined) focusedBlocks.add(owner);
      }
    }
    drawSemantic(ctx, sem, ba, a, r, (name) => dim(focusedBlocks?.has(name) ?? false));
  }

  // Notas (encima de las tarjetas, como en PlantUML)
  if (!boxesOnly && ca > 0 && layout.notes && layout.notes.length > 0) {
    const byId = new Map<string, NodeBox>(layout.nodes.map((n) => [n.id, n]));
    const noteFx = a.fx?.notes;
    if (noteFx && noteFx.size > 0) {
      // Las que entran o salen llevan su propia opacidad; el resto se dibuja junto.
      ctx.globalAlpha = dim(false) * ca;
      drawNotes(ctx, layout.notes.filter((n) => !noteFx.has(n.id)), byId, theme, px, r);
      for (const n of layout.notes) {
        const al = noteFx.get(n.id);
        if (al === undefined) continue;
        ctx.globalAlpha = dim(false) * al * ca;
        drawNotes(ctx, [n], byId, theme, px, r);
      }
    } else {
      ctx.globalAlpha = dim(false) * ca;
      drawNotes(ctx, layout.notes, byId, theme, px, r);
    }
    ctx.globalAlpha = 1;
  }

  // T11: hover = borde con el color del texto; la selección ya la dibuja la tarjeta (2 px de acento + cabecera
  // tintada). Las tarjetas sin TypeNode (paquete plegado) llevan aquí su borde de selección.
  if (hoverBox && hoverBox !== selBox) {
    roundRectPath(ctx, hoverBox.x, hoverBox.y, hoverBox.w, hoverBox.h, SELECT_RADIUS);
    ctx.strokeStyle = theme.cardFg;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
  }
  if (selBox && isPackageNode(selBox.id)) {
    roundRectPath(ctx, selBox.x, selBox.y, selBox.w, selBox.h, SELECT_RADIUS);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2 * px;
    ctx.stroke();
  }

  // Halo de lo que cambió al recargar: tres aros que se abren y se apagan (sin shadowBlur, que es caro).
  if (a.halo && a.halo.size > 0) {
    for (const b of layout.nodes) {
      const k = a.halo.get(b.id);
      if (k === undefined || k <= 0) continue;
      if (b.x > rx1 || b.x + b.w < r.x || b.y > ry1 || b.y + b.h < r.y) continue;
      for (let i = 0; i < 3; i++) {
        const grow = (2 + i * 3) * px;
        roundRectPath(ctx, b.x - grow, b.y - grow, b.w + 2 * grow, b.h + 2 * grow, SELECT_RADIUS + grow);
        ctx.globalAlpha = k * (0.6 - 0.18 * i);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = (3 - i * 0.5) * px;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
