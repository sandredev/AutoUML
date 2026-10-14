// src/presentation/diagram/routing/ports.ts — selección de puertos N/S/E/W multi-pin, ranking de caras y selección coordinada de pares (puro, sin DOM/React).
import type { NodeBox } from '../types';
import { EPS, MIN_PORT_STEP, PORT_CORNER_INSET, PORT_STUB } from './constants';

export type PortSide = 'N' | 'S' | 'E' | 'W';

export interface RectBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PortPin {
  readonly x: number;
  readonly y: number;
  readonly stubX: number;
  readonly stubY: number;
  readonly side: PortSide;
  readonly pinIndex: number;
  readonly totalPins: number;
}

export interface PinPair {
  readonly srcPin: PortPin;
  readonly tgtPin: PortPin;
  readonly straight: boolean; // true si la conexión es recta (0 codos)
}

const ALL_SIDES: readonly PortSide[] = ['N', 'S', 'E', 'W'];

/** Vector unitario exterior de una cara. */
export function sideNormal(side: PortSide): { readonly dx: number; readonly dy: number } {
  switch (side) {
    case 'N': return { dx: 0, dy: -1 };
    case 'S': return { dx: 0, dy: 1 };
    case 'E': return { dx: 1, dy: 0 };
    case 'W': return { dx: -1, dy: 0 };
  }
}

/** Cara opuesta. */
export function oppositeSide(side: PortSide): PortSide {
  switch (side) {
    case 'N': return 'S';
    case 'S': return 'N';
    case 'E': return 'W';
    case 'W': return 'E';
  }
}

/** Punto del borde de la caja en la dirección (px,py) desde su centro (movido desde layout.ts). */
export function clipToBox(b: Pick<NodeBox, 'x' | 'y' | 'w' | 'h'>, px: number, py: number): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return [cx, b.y + b.h];
  const hw = b.w / 2;
  const hh = b.h / 2;
  const s = Math.abs(dx) * hh > Math.abs(dy) * hw ? hw / Math.abs(dx) : hh / Math.abs(dy);
  return [cx + dx * s, cy + dy * s];
}

/** Distancia de un punto (px, py) al borde de una caja (0 si toca el borde). */
export function distToBoxBorder(b: RectBox, px: number, py: number): number {
  const cx = Math.min(Math.max(px, b.x), b.x + b.w);
  const cy = Math.min(Math.max(py, b.y), b.y + b.h);
  const outside = Math.hypot(px - cx, py - cy);
  if (outside > EPS) return outside;
  const dLeft = Math.abs(px - b.x);
  const dRight = Math.abs(b.x + b.w - px);
  const dTop = Math.abs(py - b.y);
  const dBottom = Math.abs(b.y + b.h - py);
  return Math.min(dLeft, dRight, dTop, dBottom);
}

/** Ajusta un punto exactamente al borde más cercano de la caja para garantizar distTo(borde) == 0. */
export function snapPointToBoxBorder(b: RectBox, px: number, py: number): [number, number] {
  const cx = Math.min(Math.max(px, b.x), b.x + b.w);
  const cy = Math.min(Math.max(py, b.y), b.y + b.h);
  const dLeft = Math.abs(cx - b.x);
  const dRight = Math.abs(b.x + b.w - cx);
  const dTop = Math.abs(cy - b.y);
  const dBottom = Math.abs(b.y + b.h - cy);
  const m = Math.min(dLeft, dRight, dTop, dBottom);
  if (m === dTop) return [cx, b.y];
  if (m === dBottom) return [cx, b.y + b.h];
  if (m === dLeft) return [b.x, cy];
  return [b.x + b.w, cy];
}

/** Número impar de pins en una cara según su longitud (incluye siempre el centro). */
export function pinCountForLength(length: number, minPins = 3, maxPins = 9): number {
  const usable = Math.max(0, length - 2 * PORT_CORNER_INSET);
  const raw = Math.floor(usable / MIN_PORT_STEP) + 1;
  const clamped = Math.max(minPins, Math.min(maxPins, raw));
  return clamped % 2 === 1 ? clamped : clamped + 1;
}

/** Genera los pins candidatos de una cara (N/S/E/W) de una tarjeta. Concentra en el 50% central. */
export function pinsOnSide(
  box: RectBox,
  side: PortSide,
  forcedCount?: number,
  stubLen: number = PORT_STUB,
): PortPin[] {
  const horiz = side === 'N' || side === 'S';
  const span = horiz ? box.w : box.h;
  const count = Math.max(1, forcedCount ?? pinCountForLength(span));
  // Concentrar pines en el 50% central de la cara: inset = max(PORT_CORNER_INSET, span * 0.25)
  const inset = Math.max(PORT_CORNER_INSET, span * 0.25);
  const start = (horiz ? box.x : box.y) + inset;
  const end = (horiz ? box.x + box.w : box.y + box.h) - inset;
  const norm = sideNormal(side);
  const out: PortPin[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const pos = start + (end - start) * t;
    const x = horiz ? pos : side === 'W' ? box.x : box.x + box.w;
    const y = horiz ? (side === 'N' ? box.y : box.y + box.h) : pos;
    out.push({
      x,
      y,
      stubX: x + norm.dx * stubLen,
      stubY: y + norm.dy * stubLen,
      side,
      pinIndex: i,
      totalPins: count,
    });
  }
  return out;
}

/** Comprueba si el punto stub de un pin cae dentro de algún obstáculo. */
function isPinBlocked(pin: PortPin, obstacles: readonly RectBox[], clearance: number): boolean {
  for (const ob of obstacles) {
    if (
      pin.stubX > ob.x - clearance &&
      pin.stubX < ob.x + ob.w + clearance &&
      pin.stubY > ob.y - clearance &&
      pin.stubY < ob.y + ob.h + clearance
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Ordena los pares de caras (srcSide, tgtSide) de menor a mayor coste estimado según la posición
 * relativa entre origen y destino y la presencia de obstáculos pegados a la cara.
 */
export function rankSidePairs(
  src: RectBox,
  tgt: RectBox,
  obstacles: readonly RectBox[],
): Array<{ readonly srcSide: PortSide; readonly tgtSide: PortSide; readonly penalty: number }> {
  const scx = src.x + src.w / 2;
  const scy = src.y + src.h / 2;
  const tcx = tgt.x + tgt.w / 2;
  const tcy = tgt.y + tgt.h / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;

  const sideDirPenalty = (side: PortSide, dirX: number, dirY: number, box: RectBox): number => {
    const n = sideNormal(side);
    const dot = n.dx * dirX + n.dy * dirY;
    const len = Math.hypot(dirX, dirY) || 1;
    const cos = dot / len;
    // Penalizar salir en dirección opuesta al destino (U-turn de salida)
    let p = cos > 0.25 ? 0 : cos >= -0.15 ? 18 : 48;
    // Penalizar si el centro del lado está bloqueado de inmediato por un obstáculo
    const centerPin = pinsOnSide(box, side, 1)[0];
    if (centerPin && isPinBlocked(centerPin, obstacles, 4)) p += 60;
    return p;
  };

  const pairs: Array<{ srcSide: PortSide; tgtSide: PortSide; penalty: number }> = [];
  for (const sSide of ALL_SIDES) {
    const sp = sideDirPenalty(sSide, dx, dy, src);
    for (const tSide of ALL_SIDES) {
      const tp = sideDirPenalty(tSide, -dx, -dy, tgt);
      // Preferir caras enfrentadas cuando están alineadas en el eje principal
      let facingBonus = oppositeSide(sSide) === tSide ? -6 : 0;
      
      // Penalizar pares en la misma cara (E->E, W->W, N->N, S->S) para eliminar orejas laterales
      if (sSide === tSide) facingBonus += 60;
      
      // Bonificar S->N cuando target está claramente abajo
      if (sSide === 'S' && tSide === 'N' && tgt.y >= src.y + src.h + 12) facingBonus -= 25;
      // Bonificar N->S cuando source está claramente abajo
      if (sSide === 'N' && tSide === 'S' && src.y >= tgt.y + tgt.h + 12) facingBonus -= 25;
      // Bonificar E->W cuando target está claramente a la derecha y no apilados verticalmente
      if (sSide === 'E' && tSide === 'W' && tgt.x >= src.x + src.w + 12 && Math.abs(dy) < Math.max(src.h, tgt.h) * 0.6) facingBonus -= 25;
      // Bonificar W->E cuando source está claramente a la derecha y no apilados verticalmente
      if (sSide === 'W' && tSide === 'E' && src.x >= tgt.x + tgt.w + 12 && Math.abs(dy) < Math.max(src.h, tgt.h) * 0.6) facingBonus -= 25;
      
      pairs.push({ srcSide: sSide, tgtSide: tSide, penalty: sp + tp + facingBonus });
    }
  }
  pairs.sort((a, b) => a.penalty - b.penalty);
  return pairs;
}

/**
 * Elige el mejor pin libre dentro de una cara, respetando el desplazamiento de canal (`laneShift`)
 * y evitando pines ya ocupados por otras aristas en esa misma cara.
 */
export function selectPinOnSide(
  box: RectBox,
  side: PortSide,
  targetCoord: number,
  laneShift: number,
  usedCoordsOnSide: readonly number[],
  obstacles: readonly RectBox[],
  requiredPins?: number,
): PortPin {
  const horiz = side === 'N' || side === 'S';
  const span = horiz ? box.w : box.h;
  const baseCount = Math.max(pinCountForLength(span), requiredPins ?? 3);
  const candidates = pinsOnSide(box, side, baseCount);
  const desired = targetCoord + laneShift;

  let best: PortPin = candidates[Math.floor(candidates.length / 2)] ?? {
    x: box.x + box.w / 2,
    y: side === 'N' ? box.y : box.y + box.h,
    stubX: box.x + box.w / 2,
    stubY: side === 'N' ? box.y - PORT_STUB : box.y + box.h + PORT_STUB,
    side,
    pinIndex: 0,
    totalPins: 1,
  };
  let bestScore = Infinity;

  for (const pin of candidates) {
    const coord = horiz ? pin.x : pin.y;
    let score = Math.abs(coord - desired);
    if (isPinBlocked(pin, obstacles, 2)) score += 500;
    for (const u of usedCoordsOnSide) {
      const dist = Math.abs(coord - u);
      if (dist < 1) score += 2000;
      else if (dist < MIN_PORT_STEP * 0.75) score += 120;
    }
    if (score < bestScore) {
      bestScore = score;
      best = pin;
    }
  }
  return best;
}

/**
 * Selecciona un par de pins coordinado (src, tgt) para un par de caras dado.
 * - Si las caras se miran (S->N, N->S, E->W, W->E) y los intervalos útiles se solapan ≥ 8px,
 *   elige una ÚNICA coordenada común `c` dentro del solape para conexión recta (0 codos).
 * - Si no hay solape, usa selectPinOnSide sesgando suavemente hacia el destino.
 */
export function selectPinPair(
  src: RectBox,
  srcSide: PortSide,
  tgt: RectBox,
  tgtSide: PortSide,
  laneShift: number,
  laneCount: number,
  usedSrcCoords: readonly number[],
  usedTgtCoords: readonly number[],
  obstacles: readonly RectBox[],
): PinPair {
  const srcHoriz = srcSide === 'N' || srcSide === 'S';
  const tgtHoriz = tgtSide === 'N' || tgtSide === 'S';
  const facing = oppositeSide(srcSide) === tgtSide;

  // Calcular intervalos útiles (50% central) de cada cara
  const srcSpan = srcHoriz ? src.w : src.h;
  const tgtSpan = tgtHoriz ? tgt.w : tgt.h;
  const srcInset = Math.max(PORT_CORNER_INSET, srcSpan * 0.25);
  const tgtInset = Math.max(PORT_CORNER_INSET, tgtSpan * 0.25);
  const srcStart = (srcHoriz ? src.x : src.y) + srcInset;
  const srcEnd = (srcHoriz ? src.x + src.w : src.y + src.h) - srcInset;
  const tgtStart = (tgtHoriz ? tgt.x : tgt.y) + tgtInset;
  const tgtEnd = (tgtHoriz ? tgt.x + tgt.w : tgt.y + tgt.h) - tgtInset;

  // Para la recta (caras enfrentadas) basta con no acercarse a las esquinas: limitarla al 50% central
  // convertía en escalón una conexión que podía ser recta entre tarjetas desalineadas.
  const straightInset = (span: number): number => Math.min(PORT_CORNER_INSET / 2, span / 4);
  const ov0 = facing
    ? Math.max((srcHoriz ? src.x : src.y) + straightInset(srcSpan), (tgtHoriz ? tgt.x : tgt.y) + straightInset(tgtSpan))
    : Math.max(srcStart, tgtStart);
  const ov1 = facing
    ? Math.min((srcHoriz ? src.x + src.w : src.y + src.h) - straightInset(srcSpan), (tgtHoriz ? tgt.x + tgt.w : tgt.y + tgt.h) - straightInset(tgtSpan))
    : Math.min(srcEnd, tgtEnd);
  const overlap = ov1 - ov0;

  // Caso 1: caras enfrentadas con solape útil ≥ 8px → conexión recta con coordenada común
  if (facing && overlap >= 8) {
    const center = (ov0 + ov1) / 2;
    // Probar offsets desde el centro + laneShift
    const offsets = [0, -16, 16, -32, 32, -48, 48];
    for (const off of offsets) {
      const c = center + laneShift + off;
      if (c < ov0 || c > ov1) continue;
      // Verificar que c no está ocupado en ninguna de las dos caras
      const srcOccupied = usedSrcCoords.some(u => Math.abs(u - c) < 1);
      const tgtOccupied = usedTgtCoords.some(u => Math.abs(u - c) < 1);
      if (srcOccupied || tgtOccupied) continue;

      // Construir pins con coordenada común c
      const normSrc = sideNormal(srcSide);
      const normTgt = sideNormal(tgtSide);
      const srcPin: PortPin = {
        x: srcHoriz ? c : srcSide === 'W' ? src.x : src.x + src.w,
        y: srcHoriz ? (srcSide === 'N' ? src.y : src.y + src.h) : c,
        stubX: (srcHoriz ? c : srcSide === 'W' ? src.x : src.x + src.w) + normSrc.dx * PORT_STUB,
        stubY: (srcHoriz ? (srcSide === 'N' ? src.y : src.y + src.h) : c) + normSrc.dy * PORT_STUB,
        side: srcSide,
        pinIndex: -1, // pin virtual
        totalPins: 1,
      };
      const tgtPin: PortPin = {
        x: tgtHoriz ? c : tgtSide === 'W' ? tgt.x : tgt.x + tgt.w,
        y: tgtHoriz ? (tgtSide === 'N' ? tgt.y : tgt.y + tgt.h) : c,
        stubX: (tgtHoriz ? c : tgtSide === 'W' ? tgt.x : tgt.x + tgt.w) + normTgt.dx * PORT_STUB,
        stubY: (tgtHoriz ? (tgtSide === 'N' ? tgt.y : tgt.y + tgt.h) : c) + normTgt.dy * PORT_STUB,
        side: tgtSide,
        pinIndex: -1,
        totalPins: 1,
      };
      // Verificar que los stubs no están bloqueados
      if (isPinBlocked(srcPin, obstacles, 2) || isPinBlocked(tgtPin, obstacles, 2)) continue;
      return { srcPin, tgtPin, straight: true };
    }
  }

  // Caso 2: no hay solape o no son caras enfrentadas → selección independiente sesgada
  const srcCenter = (srcStart + srcEnd) / 2;
  const tgtCenter = (tgtStart + tgtEnd) / 2;
  const srcTargetCoord = srcHoriz ? (tgt.x + tgt.w / 2) : (tgt.y + tgt.h / 2);
  const tgtTargetCoord = tgtHoriz ? (src.x + src.w / 2) : (src.y + src.h / 2);
  
  // Sesgo suave hacia el destino: center + clamp((target - center) * 0.35, ±span * 0.22)
  const srcBias = Math.max(-srcSpan * 0.22, Math.min(srcSpan * 0.22, (srcTargetCoord - srcCenter) * 0.35));
  const tgtBias = Math.max(-tgtSpan * 0.22, Math.min(tgtSpan * 0.22, (tgtTargetCoord - tgtCenter) * 0.35));
  const srcDesired = srcCenter + srcBias + laneShift;
  const tgtDesired = tgtCenter + tgtBias + laneShift;

  const srcPin = selectPinOnSide(src, srcSide, srcDesired, 0, usedSrcCoords, obstacles, laneCount * 2 + 1);
  const tgtPin = selectPinOnSide(tgt, tgtSide, tgtDesired, 0, usedTgtCoords, obstacles, laneCount * 2 + 1);
  return { srcPin, tgtPin, straight: false };
}