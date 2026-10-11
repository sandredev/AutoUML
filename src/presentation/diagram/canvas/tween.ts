// src/presentation/diagram/canvas/tween.ts — animación del lienzo (puro: sin DOM, React ni canvas).
// - Curvas y duraciones (criterio de las skills de diseño: UI < 300 ms, ease-out fuerte para entradas y
//   salidas, ease-in-out fuerte para lo que se mueve en pantalla).
// - blendLayouts: mezcla dos layouts por id (tarjetas que se mueven, entran o salen).
// - lerpView: vuelo de cámara (zoom exponencial + centro lineal en mundo).
// - changedTypes / haloIntensity: resaltado de lo que cambió al recargar.
import type { DiagramModel } from '../../../domain/diagram/model';
import type { EdgePath, LayoutResult, NodeBox, NoteBox, PackageBox, ViewState } from '../types';
import { boundsOf } from '../layout/stability';

// ---------- curvas ----------
/** cubic-bezier(x1, y1, x2, y2) como función t → progreso (resuelve x(s) = t por Newton + bisección). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const Y = (s: number): number => ((ay * s + by) * s + cy) * s;
  const dX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = X(s) - t;
      if (Math.abs(err) < 1e-6) return Y(s);
      const d = dX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0, hi = 1;
    s = t;
    for (let i = 0; i < 24; i++) {
      const x = X(s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return Y(s);
  };
}

/** Entradas y salidas: arranca rápido y asienta suave. */
export const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
/** Movimiento en pantalla: acelera y frena. */
export const EASE_IN_OUT = cubicBezier(0.77, 0, 0.175, 1);

// ---------- duraciones (ms) y límites ----------
export const LAYOUT_MS = 260;
/** Con prefers-reduced-motion solo hay fundidos: más cortos. */
export const REDUCED_LAYOUT_MS = 160;
export const VIEW_MS = 280;
export const HALO_MS = 2000;
/** Por encima de esto no se anima (cada fotograma reconstruye el índice espacial): se muestra directo. */
export const ANIMATION_MAX_NODES = 400;
export const ANIMATION_MAX_EDGES = 1500;

/** Las tarjetas nuevas arrancan un poco después, cuando las demás ya se han puesto en marcha. */
const ENTER_DELAY = 0.2;
/** Las que salen terminan antes que el resto: salir debe ser más rápido que entrar. */
const LEAVE_SPAN = 0.6;
const ENTER_SCALE = 0.95;
const FADED = 0.01;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------- vista ----------
/**
 * Vista intermedia entre `a` y `b`: el centro de la pantalla recorre el mundo en línea recta y el zoom
 * cambia de forma exponencial (así acercar y alejar se perciben con la misma velocidad).
 */
export function lerpView(a: ViewState, b: ViewState, t: number, viewW: number, viewH: number): ViewState {
  if (t >= 1) return { ...b };
  if (t <= 0) return { ...a };
  const ca = { x: (viewW / 2 - a.tx) / a.scale, y: (viewH / 2 - a.ty) / a.scale };
  const cb = { x: (viewW / 2 - b.tx) / b.scale, y: (viewH / 2 - b.ty) / b.scale };
  const scale = Math.exp(lerp(Math.log(a.scale), Math.log(b.scale), t));
  const cx = lerp(ca.x, cb.x, t);
  const cy = lerp(ca.y, cb.y, t);
  return { scale, tx: viewW / 2 - cx * scale, ty: viewH / 2 - cy * scale };
}

// ---------- mezcla de layouts ----------
export interface NodeFx { alpha: number; scale: number }

/** Efectos por elemento de un fotograma: lo que no aparece se dibuja normal (alpha 1, escala 1). */
export interface FrameFx {
  nodes: ReadonlyMap<string, NodeFx>;
  /** Índice en `layout.edges` → opacidad. */
  edges: ReadonlyMap<number, number>;
  packages: ReadonlyMap<string, number>;
  notes: ReadonlyMap<string, number>;
}

export interface Frame {
  /**
   * Tarjetas, aristas, paquetes y notas del layout final EN SU MISMO ORDEN (los índices de foco y hover
   * siguen valiendo), seguidas de las que están saliendo.
   */
  layout: LayoutResult;
  fx: FrameFx;
  /** Tarjetas que están saliendo: se dibujan con el modelo anterior (no existen en el nuevo). */
  leavingIds: ReadonlySet<string>;
  done: boolean;
}

/** Punto de partida de una animación: un layout y, si venía a medias, la opacidad/escala de sus tarjetas. */
export interface Snapshot {
  layout: LayoutResult;
  fx?: FrameFx | undefined;
}

export interface BlendOptions {
  /** Sin desplazamiento ni escala: solo fundidos. */
  reduceMotion?: boolean;
}

const edgeKey = (e: EdgePath): string => `${e.source}\u0001${e.target}\u0001${e.type}\u0001${e.label ?? ''}`;

function lerpBox<T extends { x: number; y: number; w: number; h: number }>(a: T, b: T, e: number): T {
  return { ...b, x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), w: lerp(a.w, b.w, e), h: lerp(a.h, b.h, e) };
}

/** Progreso a partir del cual una tarjeta que encoge adopta su tamaño final (mitad del recorrido: ease-in-out va más rápido y el salto se disimula). */
const SHRINK_AT = 0.5;

/**
 * Solo se desplaza; el tamaño nunca se interpola (el texto se dibuja a su tamaño real y con la caja a medias se saldría).
 * - Si crece, la caja ya tiene el tamaño final: el contenido nuevo no cabría en la vieja.
 * - Si encoge, conserva el viejo hasta `settled` (el contenido cabe de sobra) y salta entonces.
 */
function moveBox<T extends { x: number; y: number; w: number; h: number }>(a: T, b: T, e: number, settled: boolean): T {
  return {
    ...b,
    x: lerp(a.x, b.x, e),
    y: lerp(a.y, b.y, e),
    w: b.w >= a.w || settled ? b.w : a.w,
    h: b.h >= a.h || settled ? b.h : a.h,
  };
}

/**
 * Fotograma en el instante t ∈ [0, 1] de la transición `from` → `to`:
 * - tarjetas en los dos: se desplazan (ease-in-out); su tamaño no se interpola: si crece ya es el final, si encoge salta a mitad (el texto no cabe en una caja a medias);
 * - tarjetas nuevas: aparecen con opacidad y escala 0.95 → 1 (ease-out, con un pequeño retardo);
 * - tarjetas que desaparecen: se desvanecen en un 60 % del tiempo, donde estaban;
 * - aristas: se interpolan si conservan el número de puntos; si no, la vieja se desvanece y la nueva aparece.
 */
export function blendLayouts(from: Snapshot, to: LayoutResult, t: number, opts: BlendOptions = {}): Frame {
  const tt = clamp01(t);
  const reduce = opts.reduceMotion === true;
  const move = reduce ? 1 : EASE_IN_OUT(tt);
  const settle = EASE_OUT(tt);
  const enter = EASE_OUT(clamp01((tt - ENTER_DELAY) / (1 - ENTER_DELAY)));
  const leave = 1 - EASE_OUT(clamp01(tt / LEAVE_SPAN));
  const prevFx = from.fx;
  const settled = reduce || tt >= SHRINK_AT;

  const nodeFx = new Map<string, NodeFx>();
  const prevNodes = new Map<string, NodeBox>(from.layout.nodes.map((n) => [n.id, n]));
  const nextIds = new Set<string>();
  const nodes: NodeBox[] = to.nodes.map((n) => {
    nextIds.add(n.id);
    const p = prevNodes.get(n.id);
    if (!p) {
      nodeFx.set(n.id, { alpha: enter, scale: reduce ? 1 : lerp(ENTER_SCALE, 1, enter) });
      return n;
    }
    const pf = prevFx?.nodes.get(n.id);
    if (pf && (pf.alpha < 1 || pf.scale !== 1)) {
      // Venía a medias de otra animación: sigue desde ahí.
      nodeFx.set(n.id, { alpha: lerp(pf.alpha, 1, settle), scale: lerp(pf.scale, 1, settle) });
    }
    return moveBox(p, n, move, settled);
  });
  const leavingIds = new Set<string>();
  for (const p of from.layout.nodes) {
    if (nextIds.has(p.id)) continue;
    const alpha = (prevFx?.nodes.get(p.id)?.alpha ?? 1) * leave;
    if (alpha < FADED) continue;
    nodes.push(p);
    leavingIds.add(p.id);
    nodeFx.set(p.id, { alpha, scale: 1 });
  }

  // Aristas: las del layout final conservan sus índices; las que salen van detrás.
  const edgeFx = new Map<number, number>();
  const pool = new Map<string, EdgePath[]>();
  for (const e of from.layout.edges) {
    const k = edgeKey(e);
    const list = pool.get(k);
    if (list) list.push(e);
    else pool.set(k, [e]);
  }
  const edges: EdgePath[] = to.edges.map((e, i) => {
    const p = pool.get(edgeKey(e))?.shift();
    if (!p) {
      edgeFx.set(i, enter);
      return e;
    }
    if (p.points.length !== e.points.length) {
      // Otra ruta: la nueva aparece y la vieja (más abajo) se desvanece.
      edgeFx.set(i, enter);
      pool.get(edgeKey(e))?.unshift(p);
      return e;
    }
    return { ...e, points: e.points.map((v, k) => lerp(p.points[k] as number, v, move)) };
  });
  for (const list of pool.values()) {
    for (const p of list) {
      const alpha = leave;
      if (alpha < FADED) continue;
      // `rel` indexa el modelo anterior: sin él se dibuja con el estilo por defecto de su tipo.
      const { rel: _rel, ...rest } = p;
      edgeFx.set(edges.length, alpha);
      edges.push(rest);
    }
  }

  // Paquetes
  const packageFx = new Map<string, number>();
  const prevPkgs = new Map<string, PackageBox>(from.layout.packages.map((p) => [p.name, p]));
  const pkgNames = new Set<string>();
  const packages: PackageBox[] = to.packages.map((p) => {
    pkgNames.add(p.name);
    const q = prevPkgs.get(p.name);
    if (!q) { packageFx.set(p.name, enter); return p; }
    return lerpBox(q, p, move);
  });
  for (const q of from.layout.packages) {
    if (pkgNames.has(q.name) || leave < FADED) continue;
    packages.push(q);
    packageFx.set(q.name, leave);
  }

  // Notas
  const noteFx = new Map<string, number>();
  let notes: NoteBox[] | undefined;
  if (to.notes || from.layout.notes) {
    const prevNotes = new Map<string, NoteBox>((from.layout.notes ?? []).map((n) => [n.id, n]));
    const nextNotes = new Set<string>();
    notes = (to.notes ?? []).map((n) => {
      nextNotes.add(n.id);
      const p = prevNotes.get(n.id);
      if (!p) { noteFx.set(n.id, enter); return n; }
      return moveBox(p, n, move, settled);
    });
    for (const p of from.layout.notes ?? []) {
      if (nextNotes.has(p.id) || leave < FADED) continue;
      notes.push(p);
      noteFx.set(p.id, leave);
    }
  }

  const bounds = tt >= 1
    ? to.bounds
    : {
        x: lerp(from.layout.bounds.x, to.bounds.x, move), y: lerp(from.layout.bounds.y, to.bounds.y, move),
        w: lerp(from.layout.bounds.w, to.bounds.w, move), h: lerp(from.layout.bounds.h, to.bounds.h, move),
      };
  const layout: LayoutResult = { nodes, edges, packages, bounds: bounds.w > 0 || bounds.h > 0 ? bounds : boundsOf(nodes, packages, edges) };
  if (notes) layout.notes = notes;
  return { layout, fx: { nodes: nodeFx, edges: edgeFx, packages: packageFx, notes: noteFx }, leavingIds, done: tt >= 1 };
}

/** Punto de partida de la siguiente animación a partir del fotograma que se ve ahora (interrumpible). */
export function snapshotOf(frame: Frame): Snapshot {
  return { layout: frame.layout, fx: frame.fx };
}

/** ¿Hay algo que animar entre dos layouts? (misma geometría ⇒ no se arranca una animación vacía). */
export function layoutsDiffer(a: LayoutResult, b: LayoutResult): boolean {
  if (a === b) return false;
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length || a.packages.length !== b.packages.length) return true;
  const eps = 0.5;
  const prev = new Map(a.nodes.map((n) => [n.id, n]));
  for (const n of b.nodes) {
    const p = prev.get(n.id);
    if (!p) return true;
    if (Math.abs(p.x - n.x) > eps || Math.abs(p.y - n.y) > eps || Math.abs(p.w - n.w) > eps || Math.abs(p.h - n.h) > eps) return true;
  }
  return false;
}

/** ¿Merece la pena animar? Los diagramas enormes se muestran directamente. */
export function canAnimate(a: LayoutResult, b: LayoutResult): boolean {
  return Math.max(a.nodes.length, b.nodes.length) <= ANIMATION_MAX_NODES && Math.max(a.edges.length, b.edges.length) <= ANIMATION_MAX_EDGES;
}

// ---------- resaltado de cambios al recargar ----------
/** Contenido de una tarjeta sin su línea en el .puml (insertar una clase arriba desplaza todas las demás). */
function contentSignature(t: unknown): string {
  return JSON.stringify(t, (k, v: unknown) => (k === 'line' ? undefined : v));
}

export interface ChangedTypes { added: ReadonlySet<string>; modified: ReadonlySet<string> }

/** Tarjetas nuevas y tarjetas cuyo contenido cambió entre dos versiones del mismo documento. */
export function changedTypes(prev: DiagramModel, next: DiagramModel): ChangedTypes {
  const before = new Map(prev.types.map((t) => [t.id, contentSignature(t)] as const));
  const added = new Set<string>();
  const modified = new Set<string>();
  for (const t of next.types) {
    const old = before.get(t.id);
    if (old === undefined) added.add(t.id);
    else if (old !== contentSignature(t)) modified.add(t.id);
  }
  return { added, modified };
}

/**
 * Intensidad (0‒1) del halo `elapsed` ms después de recargar: se mantiene un momento y se apaga suave
 * hasta HALO_MS. 0 = ya no se dibuja.
 */
export function haloIntensity(elapsed: number): number {
  const t = elapsed / HALO_MS;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return t < 0.25 ? 1 : 1 - EASE_OUT((t - 0.25) / 0.75);
}
