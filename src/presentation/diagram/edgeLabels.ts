// src/presentation/diagram/edgeLabels.ts — colocación de las etiquetas de relación (puro, sin DOM/React).
// Antes la etiqueta iba siempre al centro del tramo más largo, aunque cayera encima de una tarjeta, del
// nombre de un paquete o de otra etiqueta. Aquí cada etiqueta prueba varias posiciones sobre los tramos de
// su arista y se queda con la que menos estorba; se colocan de una en una para que no se pisen entre sí.
import type { EdgePath, LayoutResult } from './types';

export interface LabelSpot {
  /** Centro de la etiqueta (la caja va centrada sobre la línea). */
  readonly x: number;
  readonly y: number;
}

/** Textos de una arista: etiqueta central y multiplicidades de cada extremo (con lo que mide su cabeza). */
export interface EdgeTexts {
  readonly label?: string | undefined;
  readonly source?: string | undefined;
  readonly target?: string | undefined;
  /** Largo de la cabeza en cada extremo (la multiplicidad va detrás de ella). */
  readonly sourceInset?: number;
  readonly targetInset?: number;
}

/** Dónde va cada texto de una arista. */
export interface EdgeLabelSpots {
  readonly label?: LabelSpot;
  readonly source?: LabelSpot;
  readonly target?: LabelSpot;
}

/** Alto de la caja de una etiqueta de relación (texto de 11px + relleno). */
export const EDGE_LABEL_H = 18;
const PAD = 2;
/** Distancia mínima de la etiqueta a los extremos de su tramo (deja ver codos y cabezas). */
const END_GAP = 8;
/** Radio de la zona de un extremo de arista que una etiqueta no debería tapar. */
const END_ZONE = 14;
/** Alto de la cabecera de un paquete donde va su nombre. */
const PKG_HEADER_H = 24;

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function segmentHitsRect(x0: number, y0: number, x1: number, y1: number, r: Rect): boolean {
  return Math.max(x0, x1) > r.x0 && Math.min(x0, x1) < r.x1 && Math.max(y0, y1) > r.y0 && Math.min(y0, y1) < r.y1;
}

/** Ancho aproximado de un texto de 11px de la familia del sistema (sin canvas). */
export function estimateLabelWidth(text: string): number {
  return text.length * 6.2;
}

/**
 * Coloca los textos de las aristas. `textsOf` da la etiqueta y las multiplicidades de cada arista y
 * `measure` el ancho de un texto en px. Primero van las multiplicidades (atadas a su extremo: prueban los
 * dos lados y dos distancias) y después las etiquetas centrales, que las esquivan.
 */
export function placeEdgeLabels(
  layout: Pick<LayoutResult, 'nodes' | 'edges' | 'packages'>,
  textsOf: (e: EdgePath, idx: number) => EdgeTexts | undefined,
  measure: (text: string) => number,
  packageNameWidth: (name: string) => number = (n) => estimateLabelWidth(n),
): Map<number, EdgeLabelSpots> {
  const result = new Map<number, { label?: LabelSpot; source?: LabelSpot; target?: LabelSpot }>();
  const spotsOf = (idx: number): { label?: LabelSpot; source?: LabelSpot; target?: LabelSpot } => {
    let r = result.get(idx);
    if (!r) {
      r = {};
      result.set(idx, r);
    }
    return r;
  };
  const nodeRects: Rect[] = layout.nodes.map((n) => ({ x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h }));
  const headerRects: Rect[] = layout.packages.map((p) => ({
    x0: p.x, y0: p.y, x1: p.x + 12 + packageNameWidth(p.name), y1: p.y + PKG_HEADER_H,
  }));
  const placed: Rect[] = [];
  // Zona de cada extremo de arista: ahí van las cabezas (hasta 18px) y las multiplicidades.
  const endZones: Rect[] = [];
  for (const e of layout.edges) {
    const q = e.points;
    const m = Math.floor(q.length / 2);
    if (m < 2) continue;
    for (const k of [0, m - 1]) {
      const x = q[k * 2] ?? 0, y = q[k * 2 + 1] ?? 0;
      endZones.push({ x0: x - END_ZONE, y0: y - END_ZONE, x1: x + END_ZONE, y1: y + END_ZONE });
    }
  }

  const texts = layout.edges.map((e, idx) => textsOf(e, idx));
  const boxScore = (r: Rect, idx: number): number => {
    let score = 0;
    for (const nr of nodeRects) {
      const a = overlapArea(r, nr);
      if (a > 0) score += 600 + a;
    }
    for (const lr of placed) if (overlapArea(r, lr) > 0) score += 900;
    for (const hr of headerRects) if (overlapArea(r, hr) > 0) score += 250;
    // Otras aristas que la etiqueta tapa
    layout.edges.forEach((o, oi) => {
      if (oi === idx) return;
      const q = o.points;
      for (let k = 0; k + 3 < q.length; k += 2) {
        if (segmentHitsRect(q[k] ?? 0, q[k + 1] ?? 0, q[k + 2] ?? 0, q[k + 3] ?? 0, r)) score += 30;
      }
    });
    return score;
  };

  // 1. Multiplicidades: junto a su extremo, detrás de la cabeza, al lado de la línea que menos estorbe.
  layout.edges.forEach((e, idx) => {
    const t = texts[idx];
    if (!t) return;
    for (const end of ['source', 'target'] as const) {
      const text = end === 'source' ? t.source : t.target;
      if (!text) continue;
      const seg = end === 'source' ? firstSeg(e.points) : lastSeg(e.points);
      if (!seg) continue;
      const inset = (end === 'source' ? t.sourceInset : t.targetInset) ?? 0;
      const [fx, fy, tx, ty] = seg;
      const len = Math.hypot(fx - tx, fy - ty) || 1;
      const ux = (fx - tx) / len;
      const uy = (fy - ty) / len;
      const w = measure(text) + 2 * PAD;
      const h = EDGE_LABEL_H;
      let best: { x: number; y: number; score: number } | null = null;
      for (const along of [14 + inset, 26 + inset]) {
        for (const side of [1, -1]) {
          // Centro desplazado hacia el lado lo justo para que la caja no tape la línea
          const off = (Math.abs(uy) > 0.5 ? w / 2 : h / 2) + 3;
          const cx = tx + ux * along - uy * off * side;
          const cy = ty + uy * along + ux * off * side;
          const r: Rect = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
          const score = boxScore(r, idx) + (along > 14 + inset ? 25 : 0) + (side < 0 ? 1 : 0);
          if (!best || score < best.score) best = { x: cx, y: cy, score };
        }
      }
      if (best) {
        spotsOf(idx)[end] = { x: best.x, y: best.y };
        placed.push({ x0: best.x - w / 2, y0: best.y - h / 2, x1: best.x + w / 2, y1: best.y + h / 2 });
      }
    }
  });

  // 2. Etiquetas centrales. Las de aristas cortas tienen menos sitio: van primero.
  const order = layout.edges
    .map((e, idx) => ({ e, idx, text: texts[idx]?.label }))
    .filter((t): t is { e: EdgePath; idx: number; text: string } => t.text !== undefined && t.text !== '' && t.e.points.length >= 4)
    .sort((a, b) => pathLength(a.e.points) - pathLength(b.e.points) || a.idx - b.idx);

  for (const { e, idx, text } of order) {
    const w = measure(text) + 2 * PAD;
    const h = EDGE_LABEL_H;
    const p = e.points;
    const n = Math.floor(p.length / 2);
    let best: { x: number; y: number; score: number } | null = null;

    const scoreAt = (cx: number, cy: number): number => {
      const r: Rect = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      let score = boxScore(r, idx);
      // Extremos de aristas: cabezas y rombos
      for (const z of endZones) if (overlapArea(r, z) > 0) score += 200;
      return score;
    };

    for (let i = 0; i < n - 1; i++) {
      const x0 = p[i * 2] ?? 0, y0 = p[i * 2 + 1] ?? 0;
      const x1 = p[i * 2 + 2] ?? 0, y1 = p[i * 2 + 3] ?? 0;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1) continue;
      const horiz = Math.abs(y1 - y0) < 0.5;
      const along = horiz ? w : h; // lo que ocupa la caja a lo largo del tramo
      const free = len - along - 2 * END_GAP;
      // Sobre la línea (la caja tapa el trazo) o, si el tramo es más corto que la etiqueta, también a un
      // lado: así no tapa su propia arista ni su cabeza.
      const offsets: readonly (readonly [number, number])[] = free > 0
        ? [[0, 0]]
        : horiz
          ? [[0, 0], [0, -(h / 2 + 3)], [0, h / 2 + 3]]
          : [[0, 0], [w / 2 + 4, 0], [-(w / 2 + 4), 0]];
      for (const t of free > 0 ? [0.5, 0.3, 0.7, 0.15, 0.85] : [0.5]) {
        // Posición a lo largo del tramo, sin acercarse a sus extremos si cabe
        const d = free > 0 ? END_GAP + along / 2 + free * t : len / 2;
        const mx = x0 + ((x1 - x0) / len) * d;
        const my = y0 + ((y1 - y0) / len) * d;
        for (const [ox, oy] of offsets) {
          const beside = ox !== 0 || oy !== 0;
          let score = scoreAt(mx + ox, my + oy);
          if (free <= 0 && !beside) score += 120; // no cabe en el tramo: tapa un codo o una cabeza
          if (beside) score += 40; // al lado se asocia peor a su línea
          if (!horiz) score += 15; // se lee mejor sobre un tramo horizontal
          score -= Math.min(len, 300) * 0.15;
          score += Math.abs(t - 0.5) * 20;
          if (!best || score < best.score) best = { x: mx + ox, y: my + oy, score };
        }
      }
    }
    if (best) {
      spotsOf(idx).label = { x: best.x, y: best.y };
      placed.push({ x0: best.x - w / 2, y0: best.y - h / 2, x1: best.x + w / 2, y1: best.y + h / 2 });
    }
  }
  return result;
}

function pathLength(p: readonly number[]): number {
  let s = 0;
  for (let k = 0; k + 3 < p.length; k += 2) s += Math.abs((p[k + 2] ?? 0) - (p[k] ?? 0)) + Math.abs((p[k + 3] ?? 0) - (p[k + 1] ?? 0));
  return s;
}

/** Primer tramo no degenerado como [desdeX, desdeY, extremoX, extremoY] (el extremo es el origen). */
function firstSeg(p: readonly number[]): [number, number, number, number] | null {
  const n = Math.floor(p.length / 2);
  const sx = p[0] ?? 0, sy = p[1] ?? 0;
  for (let i = 1; i < n; i++) {
    const x = p[i * 2] ?? 0, y = p[i * 2 + 1] ?? 0;
    if (Math.abs(x - sx) > 0.01 || Math.abs(y - sy) > 0.01) return [x, y, sx, sy];
  }
  return null;
}

/** Último tramo no degenerado como [desdeX, desdeY, extremoX, extremoY] (el extremo es el destino). */
function lastSeg(p: readonly number[]): [number, number, number, number] | null {
  const n = Math.floor(p.length / 2);
  const ex = p[n * 2 - 2] ?? 0, ey = p[n * 2 - 1] ?? 0;
  for (let i = n - 2; i >= 0; i--) {
    const x = p[i * 2] ?? 0, y = p[i * 2 + 1] ?? 0;
    if (Math.abs(x - ex) > 0.01 || Math.abs(y - ey) > 0.01) return [x, y, ex, ey];
  }
  return null;
}
