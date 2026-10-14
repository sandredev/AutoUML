// src/presentation/diagram/routing/graph.ts — grafo ortogonal Hanan con obstáculos inflados (puro, sin DOM/React).
import type { NodeBox, NoteBox, PackageBox } from '../types';
import { CHANNEL_STEP, EDGE_GAP, EPS, NEAR_BORDER_EPS } from './constants';
import type { PortPin, RectBox } from './ports';

export interface ObstacleBox {
  readonly id: string;
  readonly kind: 'node' | 'package' | 'note' | 'loop';
  /** Caja real sin inflar. */
  readonly raw: RectBox;
  /** Caja inflada por EDGE_GAP. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Construye la lista de obstáculos activos para rutear una arista `source -> target`.
 * - Nodos ajenos inflados por `EDGE_GAP = 8`.
 * - Nodos propio origen/destino inflados por `NEAR_BORDER_EPS = 2` (para que la ruta no atraviese su propia tarjeta).
 * - Paquetes ajenos (`pkg.name !== srcPkg && pkg.name !== tgtPkg`) inflados por `EDGE_GAP = 8`.
 * - Notas (`NoteBox`) infladas por `EDGE_GAP = 8`.
 * - Carriles reservados de `self-loops`.
 */
export function collectObstaclesForEdge(
  source: NodeBox,
  target: NodeBox,
  allNodes: readonly NodeBox[],
  allPackages: readonly PackageBox[],
  allNotes: readonly NoteBox[],
  reservedLoops: readonly RectBox[],
): ObstacleBox[] {
  const out: ObstacleBox[] = [];
  const srcPkg = source.packageName;
  const tgtPkg = target.packageName;

  for (const n of allNodes) {
    const isEndpoint = n.id === source.id || n.id === target.id;
    const pad = isEndpoint ? NEAR_BORDER_EPS : EDGE_GAP;
    out.push({
      id: n.id,
      kind: 'node',
      raw: { x: n.x, y: n.y, w: n.w, h: n.h },
      x0: n.x - pad,
      y0: n.y - pad,
      x1: n.x + n.w + pad,
      y1: n.y + n.h + pad,
    });
  }

  for (const p of allPackages) {
    if (p.name === srcPkg || p.name === tgtPkg) continue;
    // Ignorar también si el nodo origen o destino está geométricamente dentro del paquete
    const srcInside =
      source.x >= p.x - EPS &&
      source.y >= p.y - EPS &&
      source.x + source.w <= p.x + p.w + EPS &&
      source.y + source.h <= p.y + p.h + EPS;
    const tgtInside =
      target.x >= p.x - EPS &&
      target.y >= p.y - EPS &&
      target.x + target.w <= p.x + p.w + EPS &&
      target.y + target.h <= p.y + p.h + EPS;
    if (srcInside || tgtInside) continue;

    out.push({
      id: `pkg::${p.name}`,
      kind: 'package',
      raw: { x: p.x, y: p.y, w: p.w, h: p.h },
      x0: p.x - EDGE_GAP,
      y0: p.y - EDGE_GAP,
      x1: p.x + p.w + EDGE_GAP,
      y1: p.y + p.h + EDGE_GAP,
    });
  }

  for (const note of allNotes) {
    out.push({
      id: `note::${note.id}`,
      kind: 'note',
      raw: { x: note.x, y: note.y, w: note.w, h: note.h },
      x0: note.x - EDGE_GAP,
      y0: note.y - EDGE_GAP,
      x1: note.x + note.w + EDGE_GAP,
      y1: note.y + note.h + EDGE_GAP,
    });
  }

  reservedLoops.forEach((loop, idx) => {
    out.push({
      id: `loop::${idx}`,
      kind: 'loop',
      raw: loop,
      x0: loop.x - 4,
      y0: loop.y - 4,
      x1: loop.x + loop.w + 4,
      y1: loop.y + loop.h + 4,
    });
  });

  return out;
}

/**
 * Comprueba si un segmento ortogonal `(ax, ay) -> (bx, by)` atraviesa un obstáculo.
 * Si `useInflated` es `true`, exige respetar el margen `EDGE_GAP`; si es `false`, exige respetar
 * al menos `NEAR_BORDER_EPS = 2` respecto a la caja real.
 * Si `isPortAdjacent` es `true`, el tramo toca un puerto (stub): se recortan 3px en cada extremo
 * antes de testear (los tallos rozan legalmente la zona de near-border de su propia tarjeta).
 */
export function segmentHitsObstacle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  obstacles: readonly ObstacleBox[],
  useInflated: boolean,
  isPortAdjacent = false,
): boolean {
  if (isPortAdjacent) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 7) return false; // más corto que el recorte: no hay interior que testear
    const t = 3 / len;
    ax += dx * t;
    ay += dy * t;
    bx -= dx * t;
    by -= dy * t;
  }

  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);

  for (const ob of obstacles) {
    const ox0 = useInflated ? ob.x0 : ob.raw.x - NEAR_BORDER_EPS;
    const oy0 = useInflated ? ob.y0 : ob.raw.y - NEAR_BORDER_EPS;
    const ox1 = useInflated ? ob.x1 : ob.raw.x + ob.raw.w + NEAR_BORDER_EPS;
    const oy1 = useInflated ? ob.y1 : ob.raw.y + ob.raw.h + NEAR_BORDER_EPS;

    if (maxX > ox0 + EPS && minX < ox1 - EPS && maxY > oy0 + EPS && minY < oy1 - EPS) {
      return true;
    }
  }
  return false;
}

/** Tamaño de celda del índice espacial de obstáculos (grilla hash uniforme). */
const OBSTACLE_GRID_CELL = 64;

/**
 * Índice espacial sobre una lista fija de obstáculos para acelerar `segmentHitsObstacle`
 * en bucles calientes (A*): en vez de barrer los ~100 obstáculos por tramo, solo examina
 * los que tocan las celdas del bbox del tramo. Los resultados son idénticos al barrido
 * lineal (el pre-filtro por celdas es un superset conservador y el test exacto es el mismo).
 */
export class ObstacleIndex {
  private readonly obstacles: readonly ObstacleBox[];
  private readonly grid = new Map<number, number[]>();

  public constructor(obstacles: readonly ObstacleBox[]) {
    this.obstacles = obstacles;
    obstacles.forEach((ob, idx) => {
      // Indexar por la caja inflada (la mayor de las dos variantes): vale para
      // `useInflated` true y false porque el test exacto filtra después.
      const minCX = Math.floor(ob.x0 / OBSTACLE_GRID_CELL);
      const maxCX = Math.floor(ob.x1 / OBSTACLE_GRID_CELL);
      const minCY = Math.floor(ob.y0 / OBSTACLE_GRID_CELL);
      const maxCY = Math.floor(ob.y1 / OBSTACLE_GRID_CELL);
      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const key = cx * 4096 + cy;
          const list = this.grid.get(key);
          if (list) list.push(idx);
          else this.grid.set(key, [idx]);
        }
      }
    });
  }

  public hits(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    useInflated: boolean,
    isPortAdjacent = false,
  ): boolean {
    if (isPortAdjacent) {
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 7) return false;
      const t = 3 / len;
      ax += dx * t;
      ay += dy * t;
      bx -= dx * t;
      by -= dy * t;
    }

    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);

    const minCX = Math.floor(minX / OBSTACLE_GRID_CELL);
    const maxCX = Math.floor(maxX / OBSTACLE_GRID_CELL);
    const minCY = Math.floor(minY / OBSTACLE_GRID_CELL);
    const maxCY = Math.floor(maxY / OBSTACLE_GRID_CELL);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const list = this.grid.get(cx * 4096 + cy);
        if (!list) continue;
        for (const idx of list) {
          const ob = this.obstacles[idx];
          if (!ob) continue;
          const ox0 = useInflated ? ob.x0 : ob.raw.x - NEAR_BORDER_EPS;
          const oy0 = useInflated ? ob.y0 : ob.raw.y - NEAR_BORDER_EPS;
          const ox1 = useInflated ? ob.x1 : ob.raw.x + ob.raw.w + NEAR_BORDER_EPS;
          const oy1 = useInflated ? ob.y1 : ob.raw.y + ob.raw.h + NEAR_BORDER_EPS;
          if (maxX > ox0 + EPS && minX < ox1 - EPS && maxY > oy0 + EPS && minY < oy1 - EPS) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

/** Deduplica coordenadas ordenadas dejando al menos `minGap` salvo para coordenadas obligatorias (`exactSet`). */
function dedupCoords(values: readonly number[], exactSet: ReadonlySet<number>): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!Number.isFinite(v)) continue;
    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(v);
      continue;
    }
    if (Math.abs(v - last) < EPS) continue;
    if (Math.abs(v - last) < 2 && !exactSet.has(v) && !exactSet.has(last)) continue;
    out.push(v);
  }
  return out;
}

export interface HananGrid {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/**
 * Construye las líneas X e Y del Hanan Grid local alrededor del corredor `(srcPin, tgtPin)` y los
 * obstáculos cercanos. Incluye líneas medias entre obstáculos y carriles desplazados por `laneShift`.
 */
export function buildHananGrid(
  srcPin: PortPin,
  tgtPin: PortPin,
  obstacles: readonly ObstacleBox[],
  laneShift: number,
): HananGrid {
  const exactX = new Set<number>([srcPin.x, srcPin.stubX, tgtPin.x, tgtPin.stubX]);
  const exactY = new Set<number>([srcPin.y, srcPin.stubY, tgtPin.y, tgtPin.stubY]);

  const midX = (srcPin.stubX + tgtPin.stubX) / 2 + laneShift;
  const midY = (srcPin.stubY + tgtPin.stubY) / 2 + laneShift;
  exactX.add(midX);
  exactY.add(midY);

  const rawXs: number[] = [...exactX, midX - CHANNEL_STEP, midX + CHANNEL_STEP];
  const rawYs: number[] = [...exactY, midY - CHANNEL_STEP, midY + CHANNEL_STEP];

  // Ventana local de obstáculos para A* (PAD = 96px).
  // Solo obstáculos dentro del bbox expandido del origen/destino aceleran drásticamente
  // la construcción del grafo de visibilidad (|xs| × |ys| de ~1500 a ~80-120).
  // Si el A* local no encuentra camino, reintenta con todos los obstáculos.
  const PAD = 96;
  const wx0 = Math.min(srcPin.x, tgtPin.x) - PAD;
  const wy0 = Math.min(srcPin.y, tgtPin.y) - PAD;
  const wx1 = Math.max(srcPin.x, tgtPin.x) + PAD;
  const wy1 = Math.max(srcPin.y, tgtPin.y) + PAD;

  const localObs = obstacles.filter(
    (o) => o.x1 >= wx0 && o.x0 <= wx1 && o.y1 >= wy0 && o.y0 <= wy1,
  );
  const inWindow = localObs.length > 0 ? localObs : obstacles;
  // Acotar el grid: como mucho los 32 obstáculos más cercanos al corredor (el A* es O(nx*ny))
  const midCX = (srcPin.stubX + tgtPin.stubX) / 2;
  const midCY = (srcPin.stubY + tgtPin.stubY) / 2;
  const activeObs = inWindow.length > 32
    ? [...inWindow]
        .sort((a, b) => {
          const da = Math.hypot((a.x0 + a.x1) / 2 - midCX, (a.y0 + a.y1) / 2 - midCY);
          const db = Math.hypot((b.x0 + b.x1) / 2 - midCX, (b.y0 + b.y1) / 2 - midCY);
          return da - db;
        })
        .slice(0, 32)
    : inWindow;

  for (const ob of activeObs) {
    rawXs.push(ob.x0, ob.x1, ob.x0 - CHANNEL_STEP, ob.x1 + CHANNEL_STEP);
    rawYs.push(ob.y0, ob.y1, ob.y0 - CHANNEL_STEP, ob.y1 + CHANNEL_STEP);
  }

  // Añadir los centros de los pasillos entre cajas vecinas (canales naturales)
  for (let i = 0; i < activeObs.length; i++) {
    const a = activeObs[i];
    if (!a) continue;
    for (let j = i + 1; j < activeObs.length; j++) {
      const b = activeObs[j];
      if (!b) continue;
      if (a.x1 < b.x0 && b.x0 - a.x1 < 160) rawXs.push((a.x1 + b.x0) / 2 + laneShift * 0.5);
      else if (b.x1 < a.x0 && a.x0 - b.x1 < 160) rawXs.push((b.x1 + a.x0) / 2 + laneShift * 0.5);

      if (a.y1 < b.y0 && b.y0 - a.y1 < 160) rawYs.push((a.y1 + b.y0) / 2 + laneShift * 0.5);
      else if (b.y1 < a.y0 && a.y0 - b.y1 < 160) rawYs.push((b.y1 + a.y0) / 2 + laneShift * 0.5);
    }
  }

  return {
    xs: dedupCoords(rawXs, exactX),
    ys: dedupCoords(rawYs, exactY),
  };
}
