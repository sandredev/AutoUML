// src/presentation/diagram/layout/stability.ts — layout estable entre recálculos (puro, sin DOM/React/ELK).
// Idea: al recalcular tras un cambio pequeño, las tarjetas que ya existían deben quedarse donde estaban.
// - hintsOf: posiciones del layout anterior (la pista que se le da al motor).
// - completeHints: da posición de partida a las tarjetas nuevas, junto a sus vecinas.
// - anchorToHints: traslada el layout nuevo para que los supervivientes no se muevan en bloque.
import type { EdgePath, LayoutResult, NodeBox, NoteBox, PackageBox } from '../types';

export interface Point { x: number; y: number }
/** id → esquina superior izquierda en el layout anterior. Los paquetes van con la clave `pkg::<nombre>`. */
export type LayoutHints = Readonly<Record<string, Point>>;

/** Prefijo de los paquetes en las pistas (el mismo que usa ELK para sus nodos de paquete). */
export const PKG_HINT_PREFIX = 'pkg::';
/** Por debajo de esta fracción de tarjetas supervivientes el diagrama cambió demasiado: layout desde cero. */
export const MIN_SURVIVING_FRACTION = 0.5;
/** Con menos supervivientes que esto no hay nada que estabilizar. */
export const MIN_SURVIVING_NODES = 3;

const fin = (n: number): boolean => Number.isFinite(n);

/** Posiciones de tarjetas y paquetes de un layout, para usarlas como pista del siguiente. */
export function hintsOf(layout: LayoutResult): LayoutHints {
  const out: Record<string, Point> = {};
  for (const n of layout.nodes) if (fin(n.x) && fin(n.y)) out[n.id] = { x: n.x, y: n.y };
  for (const p of layout.packages) if (fin(p.x) && fin(p.y)) out[PKG_HINT_PREFIX + p.name] = { x: p.x, y: p.y };
  return out;
}

/** ¿Merece la pena usar las pistas? Solo si sobrevive una parte suficiente del diagrama anterior. */
export function hintsUsable(ids: readonly string[], hints: LayoutHints | undefined): boolean {
  if (!hints || ids.length === 0) return false;
  let kept = 0;
  for (const id of ids) if (hints[id]) kept++;
  return kept >= MIN_SURVIVING_NODES && kept / ids.length >= MIN_SURVIVING_FRACTION;
}

export interface SeedArgs {
  /** Ids de las tarjetas del layout nuevo. */
  ids: readonly string[];
  hints: LayoutHints;
  /** Aristas en sentido de layering: `from` queda antes que `to` (arriba en TB, a la izquierda en LR). */
  edges: readonly { from: string; to: string }[];
  size: (id: string) => { w: number; h: number };
  dir: 'TB' | 'LR';
  rankSep: number;
  nodeSep: number;
  /** Paquete de cada tarjeta: una tarjeta nueva se coloca dentro del rango de su paquete (en el eje transversal). */
  groupOf?: (id: string) => string | undefined;
}

/**
 * Completa las pistas con una posición de partida para cada tarjeta nueva: en la capa siguiente (o
 * anterior) a sus vecinas ya colocadas y a su altura media. Las que no tienen vecinas colocadas van al
 * final de la primera capa. Devuelve un mapa nuevo con TODOS los ids (las pistas sobrantes se descartan).
 */
export function completeHints(a: SeedArgs): Record<string, Point> {
  const tb = a.dir === 'TB';
  const out: Record<string, Point> = {};
  for (const id of a.ids) {
    const h = a.hints[id];
    if (h) out[id] = { x: h.x, y: h.y };
  }
  const pending = a.ids.filter((id) => !out[id]);
  if (pending.length === 0) return out;

  // Límites de lo ya colocado: sirven para los nodos sin vecinas.
  let minFlow = Infinity, maxCross = -Infinity;
  for (const id of a.ids) {
    const p = out[id];
    if (!p) continue;
    minFlow = Math.min(minFlow, tb ? p.y : p.x);
    maxCross = Math.max(maxCross, (tb ? p.x : p.y) + (tb ? a.size(id).w : a.size(id).h));
  }
  if (!fin(minFlow)) { minFlow = 0; maxCross = 0; }

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const e of a.edges) {
    push(succs, e.from, e.to);
    push(preds, e.to, e.from);
  }

  // Capas del layout anterior (intervalos de flujo que se solapan) y hueco típico entre ellas: la tarjeta
  // nueva se coloca en la capa contigua a sus vecinas, no a una distancia fija (que cae en la capa equivocada).
  const flowLo = (id: string): number => { const p = out[id] as Point; return tb ? p.y : p.x; };
  const flowLen = (id: string): number => (tb ? a.size(id).h : a.size(id).w);
  const bands: { lo: number; hi: number }[] = [];
  for (const id of [...a.ids].filter((i) => out[i]).sort((p, q) => flowLo(p) - flowLo(q))) {
    const lo = flowLo(id), hi = lo + flowLen(id);
    const last = bands[bands.length - 1];
    if (last && lo < last.hi) last.hi = Math.max(last.hi, hi);
    else bands.push({ lo, hi });
  }
  let layerGap = a.rankSep;
  if (bands.length > 1) {
    layerGap = Infinity;
    for (let i = 1; i < bands.length; i++) layerGap = Math.min(layerGap, (bands[i] as { lo: number }).lo - (bands[i - 1] as { hi: number }).hi);
    if (!fin(layerGap) || layerGap < 0) layerGap = a.rankSep;
  }
  const bandOf = (id: string): number => {
    const lo = flowLo(id), hi = lo + flowLen(id);
    return bands.findIndex((b) => lo < b.hi && hi > b.lo);
  };

  // Rango transversal que ocupan los miembros ya colocados de cada paquete.
  const ranges = new Map<string, { lo: number; hi: number }>();
  if (a.groupOf) {
    for (const id of a.ids) {
      const g = a.groupOf(id);
      const p = out[id];
      if (g === undefined || !p) continue;
      const lo = tb ? p.x : p.y;
      const hi = lo + (tb ? a.size(id).w : a.size(id).h);
      const r = ranges.get(g);
      if (r) { r.lo = Math.min(r.lo, lo); r.hi = Math.max(r.hi, hi); }
      else ranges.set(g, { lo, hi });
    }
  }

  const placeFrom = (id: string): boolean => {
    const s = a.size(id);
    const flowSize = tb ? s.h : s.w;
    const before = (preds.get(id) ?? []).map((n) => ({ n, p: out[n] })).filter((v): v is { n: string; p: Point } => !!v.p);
    const after = (succs.get(id) ?? []).map((n) => ({ n, p: out[n] })).filter((v): v is { n: string; p: Point } => !!v.p);
    if (before.length === 0 && after.length === 0) return false;
    const crossOf = (p: Point): number => (tb ? p.x : p.y);
    let cross = [...before, ...after].reduce((acc, v) => acc + crossOf(v.p), 0) / (before.length + after.length);
    const g = a.groupOf?.(id);
    const range = g !== undefined ? ranges.get(g) : undefined;
    if (range) {
      // Dentro del paquete: así su caja no se estira hasta las vecinas de otro paquete.
      const crossSize = tb ? s.w : s.h;
      cross = Math.min(Math.max(cross, range.lo), Math.max(range.lo, range.hi - crossSize));
    }
    let flow: number;
    if (before.length > 0) {
      // En la capa siguiente a la de la última predecesora (o una nueva detrás, si ya es la última).
      const k = Math.max(...before.map((v) => bandOf(v.n)));
      const bottom = Math.max(...before.map((v) => (tb ? v.p.y + a.size(v.n).h : v.p.x + a.size(v.n).w)));
      const next = k >= 0 ? bands[k + 1] : undefined;
      flow = next ? next.lo : bottom + layerGap;
    } else {
      // En la capa anterior a la de la primera sucesora (o una nueva delante, si ya es la primera).
      const k = Math.min(...after.map((v) => bandOf(v.n)));
      const top = Math.min(...after.map((v) => (tb ? v.p.y : v.p.x)));
      const prev = k >= 1 ? bands[k - 1] : undefined;
      flow = prev ? prev.lo : top - layerGap - flowSize;
    }
    cross = freeSlot(id, cross, flow, flowSize);
    out[id] = tb ? { x: cross, y: flow } : { x: flow, y: cross };
    return true;
  };

  /**
   * Posición transversal libre más cercana a `want` en la fila (capa) donde cae la tarjeta: así el
   * colocador no tiene que empujar a las tarjetas que ya estaban.
   */
  const freeSlot = (id: string, want: number, flow: number, flowSize: number): number => {
    const size = tb ? a.size(id).w : a.size(id).h;
    const taken: { lo: number; hi: number }[] = [];
    for (const other of a.ids) {
      const p = out[other];
      if (other === id || !p) continue;
      const o = a.size(other);
      const f0 = tb ? p.y : p.x;
      const fLen = tb ? o.h : o.w;
      if (f0 >= flow + flowSize || f0 + fLen <= flow) continue; // otra capa
      const lo = tb ? p.x : p.y;
      taken.push({ lo: lo - a.nodeSep, hi: lo + (tb ? o.w : o.h) + a.nodeSep });
    }
    const fits = (c: number): boolean => taken.every((t) => c + size <= t.lo || c >= t.hi);
    if (taken.length === 0 || fits(want)) return want;
    let best = NaN;
    for (const t of taken) {
      for (const c of [t.hi, t.lo - size]) {
        if (fits(c) && (!fin(best) || Math.abs(c - want) < Math.abs(best - want))) best = c;
      }
    }
    return fin(best) ? best : want;
  };

  // Varias pasadas: una nueva puede colgar de otra nueva.
  let left = pending;
  for (let pass = 0; pass < 4 && left.length > 0; pass++) {
    const next: string[] = [];
    for (const id of left) if (!placeFrom(id)) next.push(id);
    if (next.length === left.length) break;
    left = next;
  }
  // Sin vecinas colocadas: al final de la primera capa, una tras otra.
  let cursor = maxCross + a.nodeSep;
  for (const id of left) {
    const s = a.size(id);
    out[id] = tb ? { x: cursor, y: minFlow } : { x: minFlow, y: cursor };
    cursor += (tb ? s.w : s.h) + a.nodeSep;
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Desplazamiento mediano de las tarjetas que están en las pistas y en el layout nuevo. */
export function medianShift(layout: LayoutResult, hints: LayoutHints): Point | null {
  const dx: number[] = [];
  const dy: number[] = [];
  for (const n of layout.nodes) {
    const h = hints[n.id];
    if (!h) continue;
    dx.push(n.x - h.x);
    dy.push(n.y - h.y);
  }
  if (dx.length === 0) return null;
  return { x: median(dx), y: median(dy) };
}

/** Copia del layout trasladada (dx, dy): tarjetas, aristas, paquetes, notas y límites. */
export function translateLayout(layout: LayoutResult, dx: number, dy: number): LayoutResult {
  if (dx === 0 && dy === 0) return layout;
  const nodes: NodeBox[] = layout.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const packages: PackageBox[] = layout.packages.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  const edges: EdgePath[] = layout.edges.map((e) => ({
    ...e,
    points: e.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)),
  }));
  const out: LayoutResult = {
    nodes, edges, packages,
    bounds: { ...layout.bounds, x: layout.bounds.x + dx, y: layout.bounds.y + dy },
  };
  if (layout.notes) out.notes = layout.notes.map((n): NoteBox => ({ ...n, x: n.x + dx, y: n.y + dy }));
  return out;
}

/** Separación mínima que se conserva entre dos capas al devolverlas a su posición anterior. */
const MIN_LAYER_GAP = 8;

interface Band { lo: number; hi: number; members: NodeBox[]; shift: number }

/**
 * Devuelve cada capa a la posición que tenía en el eje de flujo (Y en TB, X en LR).
 * ELK separa las capas según cuántas aristas pasan entre ellas, y eso cambia entre el layout jerárquico
 * (con paquetes) y el plano, aunque el diagrama sea el mismo: sin esto todo se estira.
 * Las tarjetas se desplazan rígidas (cada capa un desplazamiento constante); el hueco entre dos capas
 * interpola entre sus desplazamientos, y aristas y paquetes se deforman con la misma función.
 */
export function warpFlowToHints(layout: LayoutResult, hints: LayoutHints, dir: 'TB' | 'LR'): LayoutResult {
  const tb = dir === 'TB';
  const pos = (b: NodeBox): number => (tb ? b.y : b.x);
  const len = (b: NodeBox): number => (tb ? b.h : b.w);
  const sorted = [...layout.nodes].sort((p, q) => pos(p) - pos(q));
  const bands: Band[] = [];
  for (const n of sorted) {
    const lo = pos(n);
    const hi = lo + len(n);
    const last = bands[bands.length - 1];
    if (last && lo < last.hi) { last.hi = Math.max(last.hi, hi); last.members.push(n); }
    else bands.push({ lo, hi, members: [n], shift: NaN });
  }
  for (const b of bands) {
    const d: number[] = [];
    for (const n of b.members) {
      const h = hints[n.id];
      if (h) d.push((tb ? h.y : h.x) - pos(n));
    }
    if (d.length > 0) b.shift = median(d);
  }
  // Capas sin ninguna tarjeta conocida: heredan el desplazamiento de la vecina.
  let carry = NaN;
  for (const b of bands) { if (fin(b.shift)) carry = b.shift; else b.shift = carry; }
  carry = NaN;
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i] as Band;
    if (fin(b.shift)) carry = b.shift; else b.shift = carry;
  }
  if (bands.length === 0 || !bands.every((b) => fin(b.shift))) return layout;
  // Las capas no pueden solaparse tras moverlas (p. ej. si una capa creció con una tarjeta nueva).
  for (let i = 1; i < bands.length; i++) {
    const a = bands[i - 1] as Band;
    const b = bands[i] as Band;
    const gap = b.lo - a.hi;
    b.shift = Math.max(b.shift, a.shift + MIN_LAYER_GAP - gap);
  }

  const warp = (v: number): number => {
    const first = bands[0] as Band;
    if (v <= first.lo) return v + first.shift;
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i] as Band;
      if (v <= b.hi) return v + b.shift;
      const next = bands[i + 1];
      if (!next) return v + b.shift;
      if (v < next.lo) {
        const t = (v - b.hi) / (next.lo - b.hi);
        return v + b.shift + (next.shift - b.shift) * t;
      }
    }
    return v;
  };

  const nodes: NodeBox[] = layout.nodes.map((n) => (tb ? { ...n, y: warp(n.y) } : { ...n, x: warp(n.x) }));
  const packages: PackageBox[] = layout.packages.map((p) => {
    const a = warp(tb ? p.y : p.x);
    const z = warp((tb ? p.y + p.h : p.x + p.w));
    return tb ? { ...p, y: a, h: z - a } : { ...p, x: a, w: z - a };
  });
  const edges: EdgePath[] = layout.edges.map((e) => ({
    ...e,
    points: e.points.map((v, i) => ((i % 2 === 1) === tb ? warp(v) : v)),
  }));
  const out: LayoutResult = { nodes, edges, packages, bounds: boundsOf(nodes, packages, edges) };
  if (layout.notes) out.notes = layout.notes;
  return out;
}

/** Caja que contiene tarjetas, paquetes y todos los puntos de las aristas. */
export function boundsOf(nodes: readonly NodeBox[], packages: readonly PackageBox[], edges: readonly EdgePath[]): LayoutResult['bounds'] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of [...nodes, ...packages]) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  for (const e of edges) {
    for (let i = 0; i + 1 < e.points.length; i += 2) {
      const x = e.points[i] as number;
      const y = e.points[i + 1] as number;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return fin(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Ancla el layout nuevo al anterior: devuelve cada capa a su posición (warpFlowToHints) y traslada el
 * conjunto para que el desplazamiento mediano de las tarjetas supervivientes sea cero (ELK añade márgenes
 * y puede mover el origen). Sin supervivientes no hace nada.
 */
export function anchorToHints(layout: LayoutResult, hints: LayoutHints | undefined, dir: 'TB' | 'LR' = 'TB'): LayoutResult {
  if (!hints) return layout;
  const warped = warpFlowToHints(layout, hints, dir);
  const s = medianShift(warped, hints);
  if (!s || !fin(s.x) || !fin(s.y)) return warped;
  return translateLayout(warped, -s.x, -s.y);
}
