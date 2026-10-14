// src/presentation/diagram/layout/selfLoop.ts — bucle ortogonal de una relación de una clase consigo misma (puro, sin DOM/React).
// Lo usan los dos motores y el router ortogonal para reservar el carril arriba-derecha fuera del paquete.

/** Separación entre bucles sucesivos de la misma clase. */
export const LOOP_STEP = 10;
const LOOP_OUT = 18;
const LOOP_IN = 16;

export interface LoopRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Bucle en la esquina superior derecha: sale del borde superior, rodea la esquina y entra por el
 * borde derecho. `k` es el número de bucle de esa clase (0, 1, 2…): cada uno va más por fuera.
 * Si se pasa `pkg` y el bucle rozaría la barra superior o el borde derecho del paquete, el carril
 * exterior se coloca por fuera del paquete mientras los extremos siguen tocando la tarjeta `b`.
 */
export function selfLoopPoints(
  b: LoopRect,
  k: number,
  pkg?: LoopRect,
): number[] {
  const g = k * LOOP_STEP;
  const sx = Math.max(b.x + 4, b.x + b.w - LOOP_IN - g);
  const ey = Math.min(b.y + b.h - 4, b.y + LOOP_IN + g);
  let top = b.y - LOOP_OUT - g;
  let right = b.x + b.w + LOOP_OUT + g;

  if (pkg) {
    if (top <= pkg.y + 4) top = pkg.y - 8 - g;
    if (right >= pkg.x + pkg.w - 4) right = pkg.x + pkg.w + 8 + g;
  }

  return [sx, b.y, sx, top, right, top, right, ey, b.x + b.w, ey];
}

/** Caja envolvente del carril que ocupa el self-loop para registrarlo como obstáculo. */
export function selfLoopBoundingBox(b: LoopRect, k: number, pkg?: LoopRect): LoopRect {
  const pts = selfLoopPoints(b, k, pkg);
  const x0 = Math.min(pts[0] ?? b.x, pts[4] ?? b.x + b.w);
  const x1 = Math.max(pts[0] ?? b.x, pts[4] ?? b.x + b.w);
  const y0 = Math.min(pts[3] ?? b.y, pts[7] ?? b.y);
  const y1 = Math.max(pts[1] ?? b.y, pts[7] ?? b.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
