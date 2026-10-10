// src/presentation/diagram/layout/selfLoop.ts — bucle ortogonal de una relación de una clase consigo misma (puro).
// Lo usan los dos motores para que el bucle sea idéntico con ELK y con dagre.

/** Separación entre bucles sucesivos de la misma clase. */
export const LOOP_STEP = 10;
const LOOP_OUT = 18;
const LOOP_IN = 16;

/**
 * Bucle en la esquina superior derecha: sale del borde superior, rodea la esquina y entra por el
 * borde derecho. `k` es el número de bucle de esa clase (0, 1, 2…): cada uno va más por fuera.
 */
export function selfLoopPoints(b: { x: number; y: number; w: number; h: number }, k: number): number[] {
  const g = k * LOOP_STEP;
  const sx = Math.max(b.x + 4, b.x + b.w - LOOP_IN - g);
  const ey = Math.min(b.y + b.h - 4, b.y + LOOP_IN + g);
  const top = b.y - LOOP_OUT - g;
  const right = b.x + b.w + LOOP_OUT + g;
  return [sx, b.y, sx, top, right, top, right, ey, b.x + b.w, ey];
}
