// src/presentation/diagram/routing/router.ts — motor A* Manhattan ortogonal con evasión de obstáculos y canales (puro, sin DOM/React).
import type { RelType } from '../../../domain/diagram/model';
import { simplify } from '../canvas/edgePath';
import { selfLoopBoundingBox, selfLoopPoints } from '../layout/selfLoop';
import type { EdgePath, LayoutResult, NodeBox, NoteBox, PackageBox } from '../types';
import { assignEdgeLanes, SegmentOccupancy } from './channels';
import {
  BEND_PENALTY,
  COLINEAR_OVERLAP_PENALTY,
  CROSS_PENALTY,
  EDGE_GAP,
  EPS,
  PORT_STUB,
  UTURN_PENALTY,
} from './constants';
import { buildHananGrid, collectObstaclesForEdge, type ObstacleBox, ObstacleIndex } from './graph';
import { nudgeEdges } from './nudge';
import {
  oppositeSide,
  type PortPin,
  type PortSide,
  rankSidePairs,
  type RectBox,
  selectPinOnSide,
  selectPinPair,
  sideNormal,
  snapPointToBoxBorder,
} from './ports';

function isHierarchy(t: RelType): boolean {
  return t === 'EXTENDS' || t === 'IMPLEMENTS';
}

/**
 * Tarifa colineal usada DENTRO de la búsqueda A* (generación de candidatos).
 * El A* exacto con la tarifa completa (`COLINEAR_OVERLAP_PENALTY = 500`) es intratable
 * en diagramas densos: el coste óptimo supera tanto a la heurística Manhattan que la
 * búsqueda degenera en exhaustiva (toda la banda de caminos similares). Con una tarifa
 * de búsqueda pequeña, el A* genera rápido el camino corto que evita obstáculos;
 * la SELECCIÓN final entre candidatos (directos + A*) aplica la tarifa completa y
 * elige el de menor coste real. Es el mismo patrón en dos fases que ya usa
 * `cheapPolylineCost` (prefiltro ciego a ocupación) + `evaluatePolylineCost` (riguroso).
 */
const SEARCH_COLINEAR_TARIFF = Number((typeof process !== 'undefined' ? process.env.AUTOUML_SEARCH_TARIFF : undefined) ?? 24);

type Dir4 = 0 | 1 | 2 | 3; // 0: N, 1: S, 2: E, 3: W

function sideToDir(side: PortSide): Dir4 {
  switch (side) {
    case 'N': return 0;
    case 'S': return 1;
    case 'E': return 2;
    case 'W': return 3;
  }
}

function oppositeDir(d: Dir4): Dir4 {
  switch (d) {
    case 0: return 1;
    case 1: return 0;
    case 2: return 3;
    case 3: return 2;
  }
}

/**
 * Normaliza una polilínea ortogonal:
 * - fuerza `dx === 0 || dy === 0` exacto en cada tramo;
 * - asegura que el primer punto toque el borde de `src` y el último el borde de `tgt`;
 * - aplica `simplify` para que sea idempotente.
 */
export function normalizeOrthoPolyline(
  rawPoints: readonly number[],
  src: RectBox,
  tgt: RectBox,
): number[] {
  const simplified = simplify(rawPoints);
  const n = Math.floor(simplified.length / 2);
  if (n < 2) {
    const [sx, sy] = snapPointToBoxBorder(src, src.x + src.w / 2, src.y + src.h);
    const [tx, ty] = snapPointToBoxBorder(tgt, tgt.x + tgt.w / 2, tgt.y);
    const midY = (sy + ty) / 2;
    return simplify([sx, sy, sx, midY, tx, midY, tx, ty]);
  }

  const pts = simplified.slice();
  const [sx, sy] = snapPointToBoxBorder(src, pts[0] ?? 0, pts[1] ?? 0);
  const [tx, ty] = snapPointToBoxBorder(tgt, pts[(n - 1) * 2] ?? 0, pts[(n - 1) * 2 + 1] ?? 0);
  pts[0] = sx;
  pts[1] = sy;
  pts[(n - 1) * 2] = tx;
  pts[(n - 1) * 2 + 1] = ty;

  // Forzar ortogonalidad exacta tramo a tramo
  const ortho: number[] = [pts[0] ?? 0, pts[1] ?? 0];
  for (let i = 1; i < n; i++) {
    const px = ortho[ortho.length - 2] ?? 0;
    const py = ortho[ortho.length - 1] ?? 0;
    let cx = pts[i * 2] ?? 0;
    let cy = pts[i * 2 + 1] ?? 0;
    if (Math.abs(cx - px) < EPS) cx = px;
    else if (Math.abs(cy - py) < EPS) cy = py;
    else if (i === n - 1) {
      // Si el último punto quedó ligeramente desalineado tras el snap al borde, ajustar el codo previo
      if (ortho.length >= 4) {
        const ppx = ortho[ortho.length - 4] ?? 0;
        const ppy = ortho[ortho.length - 3] ?? 0;
        if (Math.abs(px - ppx) < EPS) {
          ortho[ortho.length - 1] = cy;
        } else if (Math.abs(py - ppy) < EPS) {
          ortho[ortho.length - 2] = cx;
        } else {
          ortho.push(cx, py);
        }
      } else {
        ortho.push(cx, py);
      }
    } else {
      ortho.push(cx, py);
    }
    ortho.push(cx, cy);
  }

  const clean = simplify(ortho);
  // Verificación final: ningún tramo diagonal residual
  const m = Math.floor(clean.length / 2);
  const verified: number[] = [clean[0] ?? 0, clean[1] ?? 0];
  for (let i = 1; i < m; i++) {
    const px = verified[verified.length - 2] ?? 0;
    const py = verified[verified.length - 1] ?? 0;
    const cx = clean[i * 2] ?? 0;
    const cy = clean[i * 2 + 1] ?? 0;
    if (Math.abs(cx - px) >= EPS && Math.abs(cy - py) >= EPS) {
      verified.push(cx, py);
    }
    verified.push(cx, cy);
  }
  return simplify(verified);
}

/** Comprueba solo si la polilínea choca con obstáculos (sin penalizar cruces/ocupación). Barato: O(tramos × obstáculos cercanos vía índice). */
function polylineHitsObstacles(
  pts: readonly number[],
  obstIndex: ObstacleIndex,
  useInflated: boolean,
): boolean {
  const n = Math.floor(pts.length / 2);
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i * 2] ?? 0;
    const y0 = pts[i * 2 + 1] ?? 0;
    const x1 = pts[(i + 1) * 2] ?? 0;
    const y1 = pts[(i + 1) * 2 + 1] ?? 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.abs(dx) + Math.abs(dy) < EPS) continue;
    const [sx, sy, ex, ey] = trimPortEnds(x0, y0, x1, y1, i === 0, i === n - 2);
    if (Math.hypot(ex - sx, ey - sy) > EPS) {
      if (obstIndex.hits(sx, sy, ex, ey, useInflated)) return true;
    }
  }
  return false;
}

/**
 * Los primeros/últimos 3px de una ruta tocan el borde de su propia tarjeta (inflada 2px): se valida solo
 * el tramo interior. El recorte nunca pasa de la mitad del tramo, así una recta muy corta entre dos
 * tarjetas casi pegadas (caras enfrentadas a 3px) no se descarta por rozar el margen de sus extremos.
 */
function trimPortEnds(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isFirst: boolean,
  isLast: boolean,
): [number, number, number, number] {
  const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
  const cut = Math.min(3, len / 2);
  const ux = Math.sign(x1 - x0);
  const uy = Math.sign(y1 - y0);
  const sx = isFirst ? x0 + ux * cut : x0;
  const sy = isFirst ? y0 + uy * cut : y0;
  const ex = isLast ? x1 - ux * cut : x1;
  const ey = isLast ? y1 - uy * cut : y1;
  return [sx, sy, ex, ey];
}

/** Coste blando por tramo que pasa a menos de EDGE_GAP de una tarjeta ajena (modo calidad). */
const TIGHT_PENALTY = 40;

/** Penalización por tramos que respetan el mínimo duro (2px) pero no el margen EDGE_GAP. */
function tightPenalty(pts: readonly number[], obstIndex: ObstacleIndex): number {
  const n = Math.floor(pts.length / 2);
  let count = 0;
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i * 2] ?? 0;
    const y0 = pts[i * 2 + 1] ?? 0;
    const x1 = pts[(i + 1) * 2] ?? 0;
    const y1 = pts[(i + 1) * 2 + 1] ?? 0;
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) < EPS) continue;
    const [sx, sy, ex, ey] = trimPortEnds(x0, y0, x1, y1, i === 0, i === n - 2);
    if (Math.hypot(ex - sx, ey - sy) > EPS && obstIndex.hits(sx, sy, ex, ey, true)) count++;
  }
  return count * TIGHT_PENALTY;
}

/** Coste barato `len + bends*12 + uturns` sin ocupación: sirve para prefiltrar candidatos directos. */
function cheapPolylineCost(pts: readonly number[]): number {
  const n = Math.floor(pts.length / 2);
  let total = 0;
  let prevDir: Dir4 | null = null;
  let prevPrevDir: Dir4 | null = null;
  let prevSegLen = 0;
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i * 2] ?? 0;
    const y0 = pts[i * 2 + 1] ?? 0;
    const x1 = pts[(i + 1) * 2] ?? 0;
    const y1 = pts[(i + 1) * 2 + 1] ?? 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.abs(dx) + Math.abs(dy);
    if (len < EPS) continue;
    const dir: Dir4 = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 2 : 3) : dy >= 0 ? 1 : 0;
    if (prevDir !== null && dir !== prevDir) {
      total += BEND_PENALTY;
      if (prevPrevDir !== null && dir === oppositeDir(prevPrevDir) && prevSegLen < 28) {
        total += UTURN_PENALTY;
      }
    }
    total += len;
    prevPrevDir = prevDir;
    prevDir = dir;
    prevSegLen = len;
  }
  return total;
}
/** Evalúa el coste total de una polilínea candidata según `len + bends*12 + cross*50 + overlap`. */
function evaluatePolylineCost(
  pts: readonly number[],
  obstIndex: ObstacleIndex,
  occupancy: SegmentOccupancy,
  useInflated: boolean,
  edgeIdx: number,
): number {
  const n = Math.floor(pts.length / 2);
  if (n < 2) return Infinity;
  let totalCost = 0;
  let prevDir: Dir4 | null = null;
  let prevPrevDir: Dir4 | null = null;
  let prevSegLen = 0;

  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i * 2] ?? 0;
    const y0 = pts[i * 2 + 1] ?? 0;
    const x1 = pts[(i + 1) * 2] ?? 0;
    const y1 = pts[(i + 1) * 2 + 1] ?? 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.abs(dx) + Math.abs(dy);
    if (len < EPS) continue;

    const [sx, sy, ex, ey] = trimPortEnds(x0, y0, x1, y1, i === 0, i === n - 2);
    if (Math.hypot(ex - sx, ey - sy) > EPS) {
      if (obstIndex.hits(sx, sy, ex, ey, useInflated)) return Infinity;
    }

    const dir: Dir4 = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 2 : 3) : dy >= 0 ? 1 : 0;
    if (prevDir !== null && dir !== prevDir) {
      totalCost += BEND_PENALTY;
      if (prevPrevDir !== null && dir === oppositeDir(prevPrevDir) && prevSegLen < 28) {
        totalCost += UTURN_PENALTY;
      }
    }

    const { crossings, colinearOverlap } = occupancy.evaluateSegment(x0, y0, x1, y1, edgeIdx);
    totalCost += len + crossings * CROSS_PENALTY + colinearOverlap * COLINEAR_OVERLAP_PENALTY;

    prevPrevDir = prevDir;
    prevDir = dir;
    prevSegLen = len;
  }

  return totalCost;
}

/** Genera candidatos directos limpios entre dos pins: 0, 1 o 2 codos sin tramos cortos. */
function directCandidates(
  srcPin: PortPin,
  tgtPin: PortPin,
  laneShift: number,
  obstacles: readonly ObstacleBox[],
): number[][] {
  const sx = srcPin.x;
  const sy = srcPin.y;
  const stx = srcPin.stubX;
  const sty = srcPin.stubY;
  const ttx = tgtPin.stubX;
  const tty = tgtPin.stubY;
  const tx = tgtPin.x;
  const ty = tgtPin.y;

  const out: number[][] = [];
  const srcSide = srcPin.side;
  const tgtSide = tgtPin.side;
  const facing = oppositeSide(srcSide) === tgtSide;
  const srcHoriz = srcSide === 'N' || srcSide === 'S';
  const tgtHoriz = tgtSide === 'N' || tgtSide === 'S';

  // a) Recta de 0 codos: caras opuestas y misma coordenada paralela
  if (facing && ((srcHoriz && tgtHoriz && Math.abs(sx - tx) < EPS) || (!srcHoriz && !tgtHoriz && Math.abs(sy - ty) < EPS))) {
    out.push([sx, sy, tx, ty]);
  }

  // b) L limpia de 1 codo: una cara N/S y otra E/W.
  // El codo debe avanzar desde cada stub en la dirección normal de su puerto
  // al menos PORT_STUB (producto punto, no por componentes).
  if (srcHoriz && !tgtHoriz) {
    // src N/S, tgt E/W: codo en (sx, ty)
    const nSrc = sideNormal(srcSide);
    const nTgt = sideNormal(tgtSide);
    const cx = sx;
    const cy = ty;
    const advSrc = (cx - stx) * nSrc.dx + (cy - sty) * nSrc.dy;
    const advTgt = (ttx - cx) * nTgt.dx + (tty - cy) * nTgt.dy;
    if (advSrc >= PORT_STUB && advTgt >= PORT_STUB) {
      out.push([sx, sy, cx, cy, tx, ty]);
    }
  } else if (!srcHoriz && tgtHoriz) {
    // src E/W, tgt N/S: codo en (tx, sy)
    const nSrc = sideNormal(srcSide);
    const nTgt = sideNormal(tgtSide);
    const cx = tx;
    const cy = sy;
    const advSrc = (cx - stx) * nSrc.dx + (cy - sty) * nSrc.dy;
    const advTgt = (ttx - cx) * nTgt.dx + (tty - cy) * nTgt.dy;
    if (advSrc >= PORT_STUB && advTgt >= PORT_STUB) {
      out.push([sx, sy, cx, cy, tx, ty]);
    }
  }

  // c) Z limpia de 2 codos por el canal intermedio.
  // Si las caras se enfrentan con un hueco menor a 2 * PORT_STUB, el avance mínimo
  // se reduce a la mitad del hueco para no exigir stubs que invadan la tarjeta vecina.
  if (srcHoriz && tgtHoriz) {
    // Ambas N/S: canal horizontal en midY
    const sDy = sideNormal(srcSide).dy;
    const tDy = sideNormal(tgtSide).dy;
    const gapY = (ty - sy) * sDy;
    const minAdv = facing && gapY > 6 ? Math.min(PORT_STUB, Math.floor(gapY / 2)) : PORT_STUB;

    const sStubY = sy + sDy * minAdv;
    const tStubY = ty + tDy * minAdv;
    const baseMidY = facing && gapY > 6 ? (sy + ty) / 2 : (sy + ty) / 2 + laneShift;
    const candidateMidYs: number[] = [baseMidY, (sy + ty) / 2, sStubY, tStubY];

    // Si hay obstáculos entre (sx, sy) y (tx, ty), añadir sus bordes superior/inferior como canales Z
    const minX = Math.min(sx, tx) - EDGE_GAP;
    const maxX = Math.max(sx, tx) + EDGE_GAP;
    const minY = Math.min(sy, ty, sStubY, tStubY) - PORT_STUB;
    const maxY = Math.max(sy, ty, sStubY, tStubY) + PORT_STUB;

    for (const { raw: obs } of obstacles) {
      if (obs.x + obs.w < minX || obs.x > maxX || obs.y + obs.h < minY || obs.y > maxY) continue;
      candidateMidYs.push(obs.y - EDGE_GAP - 1, obs.y + obs.h + EDGE_GAP + 1);
    }

    for (const midY of new Set(candidateMidYs)) {
      // El codo debe avanzar >= minAdv en la dirección del puerto y no invadir src/tgt
      const sAdvanceOk = (midY - sy) * sDy >= minAdv - EPS;
      const tAdvanceOk = (midY - ty) * tDy >= minAdv - EPS;
      if (!sAdvanceOk || !tAdvanceOk) continue;
      out.push([sx, sy, sx, midY, tx, midY, tx, ty]);
    }
  } else if (!srcHoriz && !tgtHoriz) {
    // Ambas E/W: canal vertical en midX
    const sDx = sideNormal(srcSide).dx;
    const tDx = sideNormal(tgtSide).dx;
    const gapX = (tx - sx) * sDx;
    const minAdv = facing && gapX > 6 ? Math.min(PORT_STUB, Math.floor(gapX / 2)) : PORT_STUB;

    const sStubX = sx + sDx * minAdv;
    const tStubX = tx + tDx * minAdv;
    const baseMidX = facing && gapX > 6 ? (sx + tx) / 2 : (sx + tx) / 2 + laneShift;
    const candidateMidXs: number[] = [baseMidX, (sx + tx) / 2, sStubX, tStubX];

    const minX = Math.min(sx, tx, sStubX, tStubX) - PORT_STUB;
    const maxX = Math.max(sx, tx, sStubX, tStubX) + PORT_STUB;
    const minY = Math.min(sy, ty) - EDGE_GAP;
    const maxY = Math.max(sy, ty) + EDGE_GAP;

    for (const { raw: obs } of obstacles) {
      if (obs.x + obs.w < minX || obs.x > maxX || obs.y + obs.h < minY || obs.y > maxY) continue;
      candidateMidXs.push(obs.x - EDGE_GAP - 1, obs.x + obs.w + EDGE_GAP + 1);
    }

    for (const midX of new Set(candidateMidXs)) {
      const sAdvanceOk = (midX - sx) * sDx >= minAdv - EPS;
      const tAdvanceOk = (midX - tx) * tDx >= minAdv - EPS;
      if (!sAdvanceOk || !tAdvanceOk) continue;
      out.push([sx, sy, midX, sy, midX, ty, tx, ty]);
    }
  }

  return out;
}

/** Puentes de 4 codos entre stubs. Son más caros de evaluar y compiten con rutas limpias de
 *  1-2 codos, así que solo se usan cuando ningún candidato directo es viable. */
function bridgeCandidates(srcPin: PortPin, tgtPin: PortPin, laneShift: number): number[][] {
  const out: number[][] = [];
  const sx = srcPin.x;
  const sy = srcPin.y;
  const tx = tgtPin.x;
  const ty = tgtPin.y;
  const srcHoriz = srcPin.side === 'N' || srcPin.side === 'S';
  const tgtHoriz = tgtPin.side === 'N' || tgtPin.side === 'S';
  if (srcHoriz && tgtHoriz) {
    const sStubY = sy + (sideNormal(srcPin.side).dy * PORT_STUB);
    const tStubY = ty + (sideNormal(tgtPin.side).dy * PORT_STUB);
    // Tres canales: si el central cae sobre una tarjeta, los laterales (±90 px) suelen caer en el pasillo.
    const bridgeX0 = (sx + tx) / 2 + laneShift;
    for (const bridgeX of [bridgeX0, bridgeX0 - 90, bridgeX0 + 90]) {
      out.push([sx, sy, sx, sStubY, bridgeX, sStubY, bridgeX, tStubY, tx, tStubY, tx, ty]);
    }
  } else if (!srcHoriz && !tgtHoriz) {
    const sStubX = sx + (sideNormal(srcPin.side).dx * PORT_STUB);
    const tStubX = tx + (sideNormal(tgtPin.side).dx * PORT_STUB);
    const bridgeY = (sy + ty) / 2 + laneShift;
    for (const cy of [bridgeY, Math.min(sy, ty) - 40, Math.max(sy, ty) + 40]) {
      out.push([sx, sy, sStubX, sy, sStubX, cy, tStubX, cy, tStubX, ty, tx, ty]);
    }
  }
  return out;
}

/** Binary Min-Heap ligero para el A* sobre el Hanan Grid. Ordena por (f, h, estado):
 *  ante igual coste total `f`, expande primero el estado con menor heurística `h`
 *  (más profundo / más cercano al objetivo) para no explorar todo el plateau de
 *  caminos mínimos de igual coste. El tercer nivel (id de estado) lo hace determinista. */
class MinHeap {
  private readonly fs: number[] = [];
  private readonly hs: number[] = [];
  private readonly vals: number[] = [];

  public get size(): number {
    return this.fs.length;
  }

  private less(i: number, j: number): boolean {
    const fi = this.fs[i] ?? 0;
    const fj = this.fs[j] ?? 0;
    if (fi !== fj) return fi < fj;
    const hi = this.hs[i] ?? 0;
    const hj = this.hs[j] ?? 0;
    if (hi !== hj) return hi < hj;
    return (this.vals[i] ?? 0) < (this.vals[j] ?? 0);
  }

  private swap(i: number, j: number): void {
    const tf = this.fs[i] ?? 0;
    this.fs[i] = this.fs[j] ?? 0;
    this.fs[j] = tf;
    const th = this.hs[i] ?? 0;
    this.hs[i] = this.hs[j] ?? 0;
    this.hs[j] = th;
    const tv = this.vals[i] ?? 0;
    this.vals[i] = this.vals[j] ?? 0;
    this.vals[j] = tv;
  }

  public push(f: number, h: number, state: number): void {
    let i = this.fs.length;
    this.fs.push(f);
    this.hs.push(h);
    this.vals.push(state);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  public pop(): number | undefined {
    const n = this.fs.length;
    if (n === 0) return undefined;
    const top = this.vals[0];
    const lastF = this.fs.pop() ?? 0;
    const lastH = this.hs.pop() ?? 0;
    const lastV = this.vals.pop() ?? 0;
    if (n > 1) {
      this.fs[0] = lastF;
      this.hs[0] = lastH;
      this.vals[0] = lastV;
      let i = 0;
      for (;;) {
        const left = (i << 1) + 1;
        const right = left + 1;
        let best = i;
        if (left < n - 1 && this.less(left, best)) best = left;
        if (right < n - 1 && this.less(right, best)) best = right;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return top;
  }
}

/** Ejecuta A* ortogonal en el Hanan Grid desde `srcPin.stub` hasta `tgtPin.stub`. */
/** Si dos caras se enfrentan a menos de 2 * PORT_STUB, los stubs de ambos puertos se cruzan
 *  y el A* puede trazar un gancho dentro de la tarjeta vecina. En ese caso ambos stubs se
 *  colocan en el punto medio del hueco, que queda a menos de PORT_STUB de cada puerto. */
function clampFacingStubs(srcPin: PortPin, tgtPin: PortPin): { readonly srcPin: PortPin; readonly tgtPin: PortPin } {
  if (oppositeSide(srcPin.side) !== tgtPin.side) return { srcPin, tgtPin };
  const n = sideNormal(srcPin.side);
  const gap = (tgtPin.x - srcPin.x) * n.dx + (tgtPin.y - srcPin.y) * n.dy;
  if (gap <= 0 || gap >= 2 * PORT_STUB) return { srcPin, tgtPin };
  const horiz = srcPin.side === 'N' || srcPin.side === 'S';
  const midX = (srcPin.x + tgtPin.x) / 2;
  const midY = (srcPin.y + tgtPin.y) / 2;
  return {
    srcPin: horiz ? { ...srcPin, stubY: midY } : { ...srcPin, stubX: midX },
    tgtPin: horiz ? { ...tgtPin, stubY: midY } : { ...tgtPin, stubX: midX },
  };
}

function runAStarOnHanan(
  srcPinIn: PortPin,
  tgtPinIn: PortPin,
  obstacles: readonly ObstacleBox[],
  obstIndex: ObstacleIndex,
  occupancy: SegmentOccupancy,
  laneShift: number,
  useInflated: boolean,
  edgeIdx: number,
  fastMode: boolean,
): { readonly points: number[]; readonly cost: number } | null {
  const { srcPin, tgtPin } = clampFacingStubs(srcPinIn, tgtPinIn);
  const PROF = typeof process !== 'undefined' && process.env.AUTOUML_PROF_ASTAR === '1';
  let tHeap = 0;
  let tSeg = 0;
  let tOcc = 0;
  let tGrid = 0;
  const tG0 = PROF ? performance.now() : 0;
  const grid = buildHananGrid(srcPin, tgtPin, obstacles, laneShift);
  if (PROF) tGrid += performance.now() - tG0;
  const xs = grid.xs;
  const ys = grid.ys;
  const nx = xs.length;
  const ny = ys.length;
  if (nx === 0 || ny === 0) return null;

  const findIdx = (arr: readonly number[], v: number): number => {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs((arr[i] ?? 0) - v);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  };

  const sxi = findIdx(xs, srcPin.stubX);
  const syi = findIdx(ys, srcPin.stubY);
  const txi = findIdx(xs, tgtPin.stubX);
  const tyi = findIdx(ys, tgtPin.stubY);

  // Verificar que los stubs de salida y entrada no estén bloqueados
  const startDir = sideToDir(srcPin.side);
  const endApproachDir = sideToDir(oppositeSide(tgtPin.side));

  const nStates = nx * ny * 4;
  const gScore = new Float64Array(nStates).fill(Infinity);
  const parent = new Int32Array(nStates).fill(-1);
  const heap = new MinHeap();

  const stateId = (xi: number, yi: number, d: Dir4): number => (yi * nx + xi) * 4 + d;
  const initState = stateId(sxi, syi, startDir);
  const stubStartLen = Math.abs((xs[sxi] ?? 0) - srcPin.x) + Math.abs((ys[syi] ?? 0) - srcPin.y);
  gScore[initState] = stubStartLen;

  const h = (xi: number, yi: number): number =>
    Math.abs((xs[xi] ?? 0) - (xs[txi] ?? 0)) + Math.abs((ys[yi] ?? 0) - (ys[tyi] ?? 0));

  // Búsqueda con peso en la heurística (f = g + HW*h): la heurística Manhattan ignora
  // penalizaciones por cruces/solapes, así que el A* exacto exploraría toda la banda
  // de caminos de coste similar. Modo rápido (drag, con límite de 16 ms): peso alto y
  // tarifa de búsqueda reducida. Modo calidad (layout inicial): peso casi 1, castigo
  // fuerte por codo y tarifa completa de solape colineal, para trazar L/Z limpias y no escaleras.
  const HW = fastMode ? 8 : 1.15;
  const bendPenalty = fastMode ? BEND_PENALTY : 28;
  const colinearTariff = fastMode ? SEARCH_COLINEAR_TARIFF : COLINEAR_OVERLAP_PENALTY;

  heap.push(stubStartLen + HW * h(sxi, syi), h(sxi, syi), initState);

  const stepDirs: ReadonlyArray<{ readonly dx: number; readonly dy: number; readonly dir: Dir4 }> = [
    { dx: 0, dy: -1, dir: 0 },
    { dx: 0, dy: 1, dir: 1 },
    { dx: 1, dy: 0, dir: 2 },
    { dx: -1, dy: 0, dir: 3 },
  ];

  let bestGoalState = -1;
  let bestGoalCost = Infinity;
  // Tope de expansiones: el grid puede ser grande en diagramas densos; si se supera,
  // se devuelve lo mejor encontrado (o null) y el llamante usa el fallback directo.
  let expansions = 0;
  const MAX_EXPANSIONS = 25000;

  while (heap.size > 0) {
    const tH0 = PROF ? performance.now() : 0;
    const curr = heap.pop();
    if (PROF) tHeap += performance.now() - tH0;
    if (curr === undefined) break;
    if (++expansions > MAX_EXPANSIONS) break;
    const currG = gScore[curr] ?? Infinity;
    if (currG >= bestGoalCost) break;

    const dir = (curr & 3) as Dir4;
    const cell = curr >> 2;
    const xi = cell % nx;
    const yi = Math.floor(cell / nx);

    if (xi === txi && yi === tyi) {
      const finalTurn = dir === endApproachDir ? 0 : bendPenalty;
      const stubEndLen = Math.abs(tgtPin.x - (xs[txi] ?? 0)) + Math.abs(tgtPin.y - (ys[tyi] ?? 0));
      const total = currG + finalTurn + stubEndLen;
      if (total < bestGoalCost) {
        bestGoalCost = total;
        bestGoalState = curr;
      }
      continue;
    }
    // Poda con cota inferior admisible: el coste restante desde (xi, yi) es >= Manhattan = h.
    // No altera el resultado: solo descarta estados que ya no pueden mejorar bestGoalCost.
    if (currG + h(xi, yi) >= bestGoalCost) continue;

    const x0 = xs[xi] ?? 0;
    const y0 = ys[yi] ?? 0;

    for (const step of stepDirs) {
      // No retroceder 180 grados sobre el mismo tramo
      if (step.dir === oppositeDir(dir)) continue;
      const nxi = xi + step.dx;
      const nyi = yi + step.dy;
      if (nxi < 0 || nxi >= nx || nyi < 0 || nyi >= ny) continue;

      const x1 = xs[nxi] ?? 0;
      const y1 = ys[nyi] ?? 0;
      const tS0 = PROF ? performance.now() : 0;
      const blocked = obstIndex.hits(x0, y0, x1, y1, useInflated);
      if (PROF) tSeg += performance.now() - tS0;
      if (blocked) continue;

      const segLen = Math.abs(x1 - x0) + Math.abs(y1 - y0);
      const bendCost = step.dir === dir ? 0 : bendPenalty;

      // Penalizar U-turn inmediato respecto al abuelo
      let uturnCost = 0;
      if (bendCost > 0) {
        const pState = parent[curr] ?? -1;
        if (pState >= 0) {
          const pDir = (pState & 3) as Dir4;
          if (step.dir === oppositeDir(pDir) && segLen < 28) uturnCost = UTURN_PENALTY;
        }
      }

      const tO0 = PROF ? performance.now() : 0;
      // Tarifa de búsqueda (ver SEARCH_COLINEAR_TARIFF): la selección final entre
      // candidatos aplica la tarifa completa (COLINEAR_OVERLAP_PENALTY).
      const { crossings, colinearOverlap } = occupancy.evaluateSegment(x0, y0, x1, y1, edgeIdx);
      if (PROF) tOcc += performance.now() - tO0;
      const stepCost =
        segLen +
        bendCost +
        uturnCost +
        crossings * CROSS_PENALTY +
        colinearOverlap * colinearTariff;

      const nextState = stateId(nxi, nyi, step.dir);
      const tentativeG = currG + stepCost;
      if (tentativeG < (gScore[nextState] ?? Infinity)) {
        gScore[nextState] = tentativeG;
        parent[nextState] = curr;
        const nh = h(nxi, nyi);
        const tH1 = PROF ? performance.now() : 0;
        heap.push(tentativeG + HW * nh, nh, nextState);
        if (PROF) tHeap += performance.now() - tH1;
      }
    }
  }

  if (bestGoalState < 0) return null;

  if (PROF) {
    // eslint-disable-next-line no-console
    console.log(
      `[A*] edge=${edgeIdx} exp=${expansions} heap=${tHeap.toFixed(1)}ms seg=${tSeg.toFixed(1)}ms occ=${tOcc.toFixed(1)}ms grid=${tGrid.toFixed(1)}ms`,
    );
  }

  const coreCoords: Array<[number, number]> = [];
  let trace = bestGoalState;
  while (trace >= 0) {
    const cell = trace >> 2;
    const xi = cell % nx;
    const yi = Math.floor(cell / nx);
    coreCoords.push([xs[xi] ?? 0, ys[yi] ?? 0]);
    trace = parent[trace] ?? -1;
  }
  coreCoords.reverse();

  const raw: number[] = [srcPin.x, srcPin.y];
  for (const [cx, cy] of coreCoords) raw.push(cx, cy);
  raw.push(tgtPin.x, tgtPin.y);
  return { points: raw, cost: bestGoalCost };
}

/** Puerto reservado por una arista en `usedSideCoords` (cara `nodo::lado` y coordenada a lo largo de ella). */
interface PortClaim {
  readonly key: string;
  readonly coord: number;
}

function releaseClaims(usedSideCoords: Map<string, number[]>, claims: readonly PortClaim[]): void {
  for (const c of claims) {
    const list = usedSideCoords.get(c.key);
    if (!list) continue;
    const at = list.indexOf(c.coord);
    if (at >= 0) list.splice(at, 1);
  }
}

/** Rutea una arista individual probando los mejores pares de caras/pines y eligiendo el menor coste. */
function routeSingleEdge(
  src: NodeBox,
  tgt: NodeBox,
  edgeIdx: number,
  laneShift: number,
  laneCount: number,
  obstacles: readonly ObstacleBox[],
  occupancy: SegmentOccupancy,
  usedSideCoords: Map<string, number[]>,
  fastMode: boolean,
  claims?: PortClaim[],
): number[] {
  const PROF2 = typeof process !== 'undefined' && process.env.AUTOUML_PROF_ASTAR === '1';
  const tP0 = PROF2 ? performance.now() : 0;
  const obstRects = obstacles
    .filter((o) => o.id !== src.id && o.id !== tgt.id)
    .map((o) => o.raw);
  const rankedPairs = rankSidePairs(src, tgt, obstRects).slice(0, 6);
  // Índice espacial de obstáculos (una sola construcción por arista): acelera los
  // tests de colisión en candidatos directos, evaluación de costes y A*.
  const obstIndex = new ObstacleIndex(obstacles);
  if (PROF2) {
    const g = globalThis as unknown as Record<string, number>;
    g.__tPins = (g.__tPins ?? 0) + (performance.now() - tP0);
  }

  let bestPts: number[] | null = null;
  let bestScore = Infinity;
  let bestSrcKey = '';
  let bestSrcCoord = 0;
  let bestTgtKey = '';
  let bestTgtCoord = 0;

  // Modo rápido: primero con el margen EDGE_GAP como barrera y, si no hay ruta, con 2px.
  // Modo calidad: una sola pasada con el mínimo duro de 2px y el margen EDGE_GAP como coste blando
  // (tightPenalty): así un hueco estrecho de 2 codos le gana a un rodeo de 4 (el reparto posterior
  // centra la línea en el hueco), pero un rodeo corto sigue ganando a meterse entre dos tarjetas.
  const passes: readonly boolean[] = fastMode ? [true, false] : [false];
  const tight = (pts: readonly number[], useInflated: boolean): number =>
    fastMode || useInflated ? 0 : tightPenalty(pts, obstIndex);
  for (const useInflated of passes) {
    // Fase 1 (barata): candidatos directos en todos los pares; filtrar solo por
    // obstáculos O(tramos × obstáculos) y quedarse con los 4 mejores por coste barato.
    interface Viable {
      readonly pts: number[];
      readonly cheap: number;
      readonly penalty: number;
      readonly srcKey: string;
      readonly srcCoord: number;
      readonly tgtKey: string;
      readonly tgtCoord: number;
    }
    const viable: Viable[] = [];
    // Primero candidatos de 0-2 codos en todos los pares; los puentes de 4 codos solo si
    // ningún par produce una ruta directa libre (no compiten con L/Z limpias), salvo en drag.
    const collectViable = (withBridges: boolean): void => {
      for (const pair of rankedPairs) {
        const srcKey = `${src.id}::${pair.srcSide}`;
        const tgtKey = `${tgt.id}::${pair.tgtSide}`;
        const usedSrc = usedSideCoords.get(srcKey) ?? [];
        const usedTgt = usedSideCoords.get(tgtKey) ?? [];

        // Usar selectPinPair para obtener pins coordinados
        const pinPair = selectPinPair(
          src,
          pair.srcSide,
          tgt,
          pair.tgtSide,
          laneShift,
          laneCount,
          usedSrc,
          usedTgt,
          obstRects,
        );
        const srcPin = pinPair.srcPin;
        const tgtPin = pinPair.tgtPin;

        const cands = withBridges
          ? bridgeCandidates(srcPin, tgtPin, laneShift)
          : directCandidates(srcPin, tgtPin, laneShift, obstacles);
        for (const cand of cands) {
          // Filtro previo: descarta antes de normalizar (evita arrays y simplify inútiles)
          if (polylineHitsObstacles(cand, obstIndex, useInflated)) continue;
          const norm = normalizeOrthoPolyline(cand, src, tgt);
          if (polylineHitsObstacles(norm, obstIndex, useInflated)) continue;
          const penalty = pair.penalty + tight(norm, useInflated);
          viable.push({
            pts: norm,
            cheap: cheapPolylineCost(norm) + penalty,
            penalty,
            srcKey,
            srcCoord: pair.srcSide === 'N' || pair.srcSide === 'S' ? srcPin.x : srcPin.y,
            tgtKey,
            tgtCoord: pair.tgtSide === 'N' || pair.tgtSide === 'S' ? tgtPin.x : tgtPin.y,
          });
        }
      }
    };
    collectViable(false);
    // En modo rápido (drag) los puentes se añaden siempre: sin ellos el A* se dispara y el test de 16 ms falla.
    if (viable.length === 0 || fastMode) collectViable(true);

    if (viable.length > 0) {
      // Fase 2 (cara): evaluación completa con ocupación solo sobre los 4 mejores.
      viable.sort((a, b) => a.cheap - b.cheap);
      for (const v of viable.slice(0, 4)) {
        const cCost = evaluatePolylineCost(v.pts, obstIndex, occupancy, useInflated, edgeIdx);
        const total = cCost + v.penalty;
        if (total < bestScore) {
          bestScore = total;
          bestPts = v.pts;
          bestSrcKey = v.srcKey;
          bestSrcCoord = v.srcCoord;
          bestTgtKey = v.tgtKey;
          bestTgtCoord = v.tgtCoord;
        }
      }
    } else {
      // 2. Fallback A* SOLO si Fase 1 no encontró ninguna ruta libre de obstáculos.
      // En calidad, el A* busca primero con el margen EDGE_GAP como barrera y después con 2px.
      astarSearch: for (const astarInflated of fastMode ? [useInflated] : [true, false]) {
      for (let i = 0; i < Math.min(fastMode ? 1 : 2, rankedPairs.length); i++) {
        const pair = rankedPairs[i];
        const srcKey = `${src.id}::${pair.srcSide}`;
        const tgtKey = `${tgt.id}::${pair.tgtSide}`;
        const usedSrc = usedSideCoords.get(srcKey) ?? [];
        const usedTgt = usedSideCoords.get(tgtKey) ?? [];
        // Mismos pins coordinados que la fase 1 (selectPinPair), para no desalinear los puertos
        const { srcPin, tgtPin } = selectPinPair(
          src,
          pair.srcSide,
          tgt,
          pair.tgtSide,
          laneShift,
          laneCount,
          usedSrc,
          usedTgt,
          obstRects,
        );
        const astar = runAStarOnHanan(srcPin, tgtPin, obstacles, obstIndex, occupancy, laneShift, astarInflated, edgeIdx, fastMode);
        if (astar) {
          const tN0 = PROF2 ? performance.now() : 0;
          const norm = normalizeOrthoPolyline(astar.points, src, tgt);
          const verifyCost = evaluatePolylineCost(norm, obstIndex, occupancy, astarInflated, edgeIdx);
          if (PROF2) {
            const g = globalThis as unknown as Record<string, number>;
            g.__tPost = (g.__tPost ?? 0) + (performance.now() - tN0);
          }
          // Una ruta que sigue atravesando un obstáculo (coste no finito) se descarta
          if (!Number.isFinite(verifyCost)) continue;
          const total = verifyCost + pair.penalty + tight(norm, astarInflated);
          if (total < bestScore) {
            bestScore = total;
            bestPts = norm;
            bestSrcKey = srcKey;
            bestSrcCoord = pair.srcSide === 'N' || pair.srcSide === 'S' ? srcPin.x : srcPin.y;
            bestTgtKey = tgtKey;
            bestTgtCoord = pair.tgtSide === 'N' || pair.tgtSide === 'S' ? tgtPin.x : tgtPin.y;
            break astarSearch; // Solo cortar cuando el A* fue realmente válido y libre de obstáculos
          }
        }
      }
      }
    }
    if (bestPts !== null && Number.isFinite(bestScore)) break;
  }

  if (bestPts !== null) {
    if (bestSrcKey) {
      const list = usedSideCoords.get(bestSrcKey);
      if (list) list.push(bestSrcCoord);
      else usedSideCoords.set(bestSrcKey, [bestSrcCoord]);
      claims?.push({ key: bestSrcKey, coord: bestSrcCoord });
    }
    if (bestTgtKey) {
      const list = usedSideCoords.get(bestTgtKey);
      if (list) list.push(bestTgtCoord);
      else usedSideCoords.set(bestTgtKey, [bestTgtCoord]);
      claims?.push({ key: bestTgtKey, coord: bestTgtCoord });
    }
    return bestPts;
  }

  // Fallback infalible: conexión ortogonal directa garantizada
  const fallbackPair = rankedPairs[0] ?? { srcSide: 'S' as const, tgtSide: 'N' as const, penalty: 0 };
  const sp = selectPinOnSide(src, fallbackPair.srcSide, tgt.x + tgt.w / 2, laneShift, [], []);
  const tp = selectPinOnSide(tgt, fallbackPair.tgtSide, src.x + src.w / 2, laneShift, [], []);
  const midY = (sp.stubY + tp.stubY) / 2 + laneShift;
  return normalizeOrthoPolyline([sp.x, sp.y, sp.stubX, sp.stubY, sp.stubX, midY, tp.stubX, midY, tp.stubX, tp.stubY, tp.x, tp.y], src, tgt);
}

/**
 * Orden canónico de ruteo (ortho-router regla 6):
 * 1. Jerarquía (`EXTENDS` / `IMPLEMENTS`) primero.
 * 2. Por longitud Manhattan descendente.
 * 3. Desempate determinista por `rel`, `source`, `target`.
 */
function sortEdgeIndicesForRouting(
  indices: readonly number[],
  edges: readonly EdgePath[],
  nodeById: ReadonlyMap<string, NodeBox>,
): number[] {
  return [...indices].sort((ia, ib) => {
    const ea = edges[ia];
    const eb = edges[ib];
    if (!ea || !eb) return ia - ib;
    const ha = isHierarchy(ea.type) ? 0 : 1;
    const hb = isHierarchy(eb.type) ? 0 : 1;
    if (ha !== hb) return ha - hb;

    const sa = nodeById.get(ea.source);
    const ta = nodeById.get(ea.target);
    const sb = nodeById.get(eb.source);
    const tb = nodeById.get(eb.target);
    const distA =
      sa && ta ? Math.abs(sa.x + sa.w / 2 - (ta.x + ta.w / 2)) + Math.abs(sa.y + sa.h / 2 - (ta.y + ta.h / 2)) : 0;
    const distB =
      sb && tb ? Math.abs(sb.x + sb.w / 2 - (tb.x + tb.w / 2)) + Math.abs(sb.y + sb.h / 2 - (tb.y + tb.h / 2)) : 0;
    if (Math.abs(distB - distA) > EPS) return distB - distA;

    const ra = ea.rel ?? ia;
    const rb = eb.rel ?? ib;
    if (ra !== rb) return ra - rb;
    return ia - ib;
  });
}

/** Por encima de este número de aristas se omite la segunda pasada de `routeAllEdges` (duplica su coste). */
const REROUTE_PASS_MAX_EDGES = 600;

/**
 * Rutea todas las aristas ortogonales de un layout desde cero (descartando las sections de ELK).
 * Las aristas con `routing === 'polyline'` explícito se conservan tal cual.
 */
export function routeAllEdges(
  nodes: readonly NodeBox[],
  packages: readonly PackageBox[],
  edges: readonly EdgePath[],
  notes: readonly NoteBox[] = [],
  forceOrtho = false,
): EdgePath[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const pkgByName = new Map(packages.map((p) => [p.name, p] as const));
  const lanes = assignEdgeLanes(edges);
  const occupancy = new SegmentOccupancy();
  const usedSideCoords = new Map<string, number[]>();
  const reservedLoops: RectBox[] = [];

  const result: EdgePath[] = edges.map((e) => ({ ...e, points: e.points.slice() }));

  // 1. Self-loops primero: reservan su carril arriba-derecha (fuera del paquete si toca borde)
  const loopCounts = new Map<string, number>();
  edges.forEach((e, idx) => {
    if (!e.self && e.source !== e.target) return;
    const b = nodeById.get(e.source);
    if (!b) return;
    const k = loopCounts.get(b.id) ?? 0;
    loopCounts.set(b.id, k + 1);
    const pkg = b.packageName !== undefined ? pkgByName.get(b.packageName) : undefined;
    const pts = selfLoopPoints(b, k, pkg);
    reservedLoops.push(selfLoopBoundingBox(b, k, pkg));
    occupancy.addPolyline(pts, idx);
    result[idx] = { ...e, points: pts, routing: 'orthogonal', self: true };
  });

  // 2. Aristas no-bucle ordenadas por jerarquía y longitud descendente
  const orthoIndices: number[] = [];
  edges.forEach((e, idx) => {
    if (e.self || e.source === e.target) return;
    if (!forceOrtho && e.routing === 'polyline') return;
    orthoIndices.push(idx);
  });

  const ordered = sortEdgeIndicesForRouting(orthoIndices, edges, nodeById);
  const claimsOf = new Map<number, PortClaim[]>();
  const obstaclesOf = new Map<number, ObstacleBox[]>();
  for (const idx of ordered) {
    const e = edges[idx];
    if (!e) continue;
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src || !tgt) continue;

    const lane = lanes.get(idx) ?? { laneIndex: 0, laneCount: 1, signedOffset: 0 };
    const obstacles = collectObstaclesForEdge(src, tgt, nodes, packages, notes, reservedLoops);
    obstaclesOf.set(idx, obstacles);
    const claims: PortClaim[] = [];
    const pts = routeSingleEdge(
      src,
      tgt,
      idx,
      lane.signedOffset,
      lane.laneCount,
      obstacles,
      occupancy,
      usedSideCoords,
      false,
      claims,
    );
    claimsOf.set(idx, claims);
    occupancy.addPolyline(pts, idx);
    result[idx] = { ...e, points: pts, routing: 'orthogonal' };
  }

  // Segunda pasada (rip-up and reroute): las primeras aristas se trazaron sin ver a las siguientes. Cada
  // una se retira y se vuelve a trazar conociendo todas las demás; la nueva ruta solo se queda si cuesta
  // menos (longitud + codos + cruces + solapes) frente a esas mismas aristas.
  if (ordered.length <= REROUTE_PASS_MAX_EDGES) {
    for (const idx of ordered) {
      const e = edges[idx];
      const prev = result[idx];
      const obstacles = obstaclesOf.get(idx);
      if (!e || !prev || !obstacles) continue;
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      if (!src || !tgt) continue;

      occupancy.removeEdge(idx);
      const oldClaims = claimsOf.get(idx) ?? [];
      releaseClaims(usedSideCoords, oldClaims);
      const obstIndex = new ObstacleIndex(obstacles);
      const oldCost = evaluatePolylineCost(prev.points, obstIndex, occupancy, false, idx);

      const lane = lanes.get(idx) ?? { laneIndex: 0, laneCount: 1, signedOffset: 0 };
      const claims: PortClaim[] = [];
      const pts = routeSingleEdge(
        src,
        tgt,
        idx,
        lane.signedOffset,
        lane.laneCount,
        obstacles,
        occupancy,
        usedSideCoords,
        false,
        claims,
      );
      const newCost = evaluatePolylineCost(pts, obstIndex, occupancy, false, idx);
      if (newCost + EPS < oldCost) {
        claimsOf.set(idx, claims);
        occupancy.addPolyline(pts, idx);
        result[idx] = { ...e, points: pts, routing: 'orthogonal' };
      } else {
        // Se conserva la ruta anterior: devolver sus puertos y retirar los que reservó el intento.
        releaseClaims(usedSideCoords, claims);
        for (const c of oldClaims) {
          const list = usedSideCoords.get(c.key);
          if (list) list.push(c.coord);
          else usedSideCoords.set(c.key, [c.coord]);
        }
        occupancy.addPolyline(prev.points, idx);
      }
    }
  }

  // Calidad: centrar los tramos en sus pasillos y repartir los paralelos (no cambia la topología).
  return nudgeEdges(result, nodes, packages, notes);
}

/** Comprueba si una polilínea existente choca con alguno de los rectángulos dados. */
function polylineHitsAnyBox(points: readonly number[], boxes: readonly RectBox[], pad: number): boolean {
  const n = Math.floor(points.length / 2);
  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i * 2] ?? 0;
    const y0 = points[i * 2 + 1] ?? 0;
    const x1 = points[(i + 1) * 2] ?? 0;
    const y1 = points[(i + 1) * 2 + 1] ?? 0;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    for (const b of boxes) {
      if (
        maxX > b.x - pad + EPS &&
        minX < b.x + b.w + pad - EPS &&
        maxY > b.y - pad + EPS &&
        minY < b.y + b.h + pad - EPS
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Traslada una polilínea `(dx, dy)`. */
function translatePoints(points: readonly number[], dx: number, dy: number): number[] {
  const out = points.slice();
  for (let i = 0; i + 1 < out.length; i += 2) {
    out[i] = (out[i] ?? 0) + dx;
    out[i + 1] = (out[i + 1] ?? 0) + dy;
  }
  return out;
}

/**
 * Reruteo incremental local para `applyOverrides` (<16ms con 500 aristas en drag):
 * - Solo rerutea las aristas incidentes a nodos movidos o cuyo canal fue invadido por una caja movida.
 * - Si ambos extremos de una arista se movieron exactamente el mismo `(dx, dy)` y la ruta trasladada
 *   no choca con ningún obstáculo, la traslada en O(1).
 */
export function rerouteAffectedEdges(
  nodes: readonly NodeBox[],
  packages: readonly PackageBox[],
  edges: readonly EdgePath[],
  movedNodeIds: ReadonlySet<string>,
  nodeOffsets: ReadonlyMap<string, { readonly dx: number; readonly dy: number }>,
  notes: readonly NoteBox[] = [],
): EdgePath[] {
  if (movedNodeIds.size === 0) return edges.map((e) => ({ ...e, points: e.points.slice() }));

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const pkgByName = new Map(packages.map((p) => [p.name, p] as const));
  const lanes = assignEdgeLanes(edges);
  const occupancy = new SegmentOccupancy();
  const usedSideCoords = new Map<string, number[]>();
  const reservedLoops: RectBox[] = [];

  // Cajas que cambiaron de sitio (para detectar qué aristas no conectadas fueron invadidas)
  const movedBoxes: RectBox[] = [];
  const movedPkgs = new Set<string>();
  for (const id of movedNodeIds) {
    const nb = nodeById.get(id);
    if (nb) {
      movedBoxes.push(nb);
      if (nb.packageName !== undefined) movedPkgs.add(nb.packageName);
    }
  }
  for (const pkgName of movedPkgs) {
    const pb = pkgByName.get(pkgName);
    if (pb) movedBoxes.push(pb);
  }

  const out: EdgePath[] = edges.map((e) => ({ ...e, points: e.points.slice() }));
  const dirtyOrthoIndices: number[] = [];

  // 1. Procesar self-loops y clasificar aristas limpias vs sucias
  const loopCounts = new Map<string, number>();
  edges.forEach((e, idx) => {
    if (e.self || e.source === e.target) {
      const b = nodeById.get(e.source);
      if (!b) return;
      const k = loopCounts.get(b.id) ?? 0;
      loopCounts.set(b.id, k + 1);
      const pkg = b.packageName !== undefined ? pkgByName.get(b.packageName) : undefined;
      const pts = movedNodeIds.has(e.source) ? selfLoopPoints(b, k, pkg) : e.points.slice();
      reservedLoops.push(selfLoopBoundingBox(b, k, pkg));
      occupancy.addPolyline(pts, idx);
      out[idx] = { ...e, points: pts, routing: 'orthogonal', self: true };
      return;
    }

    const srcMoved = movedNodeIds.has(e.source);
    const tgtMoved = movedNodeIds.has(e.target);
    const os = nodeOffsets.get(e.source);
    const ot = nodeOffsets.get(e.target);

    // Si ambos extremos se movieron exactamente igual, probar traslación rígida si no choca con obstáculos
    if (
      srcMoved &&
      tgtMoved &&
      os &&
      ot &&
      Math.abs(os.dx - ot.dx) < EPS &&
      Math.abs(os.dy - ot.dy) < EPS
    ) {
      const shifted = translatePoints(e.points, os.dx, os.dy);
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      if (e.routing !== 'orthogonal') {
        out[idx] = { ...e, points: shifted };
        return;
      }
      if (src && tgt) {
        const otherNodes = nodes.filter((n) => n.id !== src.id && n.id !== tgt.id);
        if (!polylineHitsAnyBox(shifted, otherNodes, EDGE_GAP)) {
          occupancy.addPolyline(shifted, idx);
          out[idx] = { ...e, points: shifted };
          return;
        }
      }
    }

    if (e.routing !== 'orthogonal') {
      // Polilínea no ortogonal (dagre legacy): mover extremos con clipToBox
      if (srcMoved || tgtMoved) {
        const pts = e.points.slice();
        if (os && pts.length >= 2) {
          pts[0] = (pts[0] ?? 0) + os.dx;
          pts[1] = (pts[1] ?? 0) + os.dy;
        }
        if (ot && pts.length >= 4) {
          pts[pts.length - 2] = (pts[pts.length - 2] ?? 0) + ot.dx;
          pts[pts.length - 1] = (pts[pts.length - 1] ?? 0) + ot.dy;
        }
        out[idx] = { ...e, points: pts };
      }
      return;
    }

    // Si un extremo se movió, si comparte par con un nodo movido, o si su camino fue invadido por una caja movida
    const invaded = !srcMoved && !tgtMoved && polylineHitsAnyBox(e.points, movedBoxes, EDGE_GAP);
    if (srcMoved || tgtMoved || invaded) {
      dirtyOrthoIndices.push(idx);
    } else {
      occupancy.addPolyline(e.points, idx);
    }
  });

  // 2. Si una arista de un par {A, B} es sucia, incluir también sus aristas hermanas del mismo par para mantener carriles
  const dirtyPairs = new Set<string>();
  for (const idx of dirtyOrthoIndices) {
    const e = edges[idx];
    if (!e) continue;
    const a = e.source < e.target ? e.source : e.target;
    const b = e.source < e.target ? e.target : e.source;
    dirtyPairs.add(`${a}::${b}`);
  }
  edges.forEach((e, idx) => {
    if (e.self || e.source === e.target || e.routing !== 'orthogonal') return;
    const a = e.source < e.target ? e.source : e.target;
    const b = e.source < e.target ? e.target : e.source;
    if (dirtyPairs.has(`${a}::${b}`) && !dirtyOrthoIndices.includes(idx)) {
      dirtyOrthoIndices.push(idx);
    }
  });

  const orderedDirty = sortEdgeIndicesForRouting(dirtyOrthoIndices, edges, nodeById);
  for (const idx of orderedDirty) {
    const e = edges[idx];
    if (!e) continue;
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src || !tgt) continue;

    const lane = lanes.get(idx) ?? { laneIndex: 0, laneCount: 1, signedOffset: 0 };
    const obstacles = collectObstaclesForEdge(src, tgt, nodes, packages, notes, reservedLoops);
    const pts = routeSingleEdge(
      src,
      tgt,
      idx,
      lane.signedOffset,
      lane.laneCount,
      obstacles,
      occupancy,
      usedSideCoords,
      true,
    );
    occupancy.addPolyline(pts, idx);
    out[idx] = { ...e, points: pts, routing: 'orthogonal' };
  }

  return out;
}

/** Calcula la caja envolvente total (`bounds`) incluyendo nodos, paquetes, notas y todos los puntos de aristas. */
export function computeDiagramBounds(
  nodes: readonly NodeBox[],
  packages: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[],
  edges: readonly EdgePath[],
  fallback: LayoutResult['bounds'] = { x: 0, y: 0, w: 0, h: 0 },
): LayoutResult['bounds'] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  const addBox = (x: number, y: number, w: number, h: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };

  for (const n of nodes) addBox(n.x, n.y, n.w, n.h);
  for (const p of packages) addBox(p.x, p.y, p.w, p.h);
  for (const e of edges) {
    for (let i = 0; i + 1 < e.points.length; i += 2) {
      addBox(e.points[i] ?? 0, e.points[i + 1] ?? 0, 0, 0);
    }
  }

  if (!Number.isFinite(x0)) return fallback;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
