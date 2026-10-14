// src/presentation/diagram/routing/channels.ts — carriles y registro de ocupación (puro, sin DOM/React).
import type { EdgePath } from '../types';
import { CHANNEL_STEP, EPS } from './constants';

export interface LaneAssignment {
  readonly laneIndex: number;
  readonly laneCount: number;
  /** Desplazamiento perpendicular en unidades de mundo (a->b y b->a desplazadas a su derecha). */
  readonly signedOffset: number;
}

/**
 * Calcula el carril de cada arista para que:
 * - aristas paralelas del mismo par no compartan carril ni puntos;
 * - relaciones recíprocas `a->b` y `b->a` queden desplazadas cada una a su derecha.
 */
export function assignEdgeLanes(
  edges: readonly Pick<EdgePath, 'source' | 'target' | 'type' | 'rel'>[],
): Map<number, LaneAssignment> {
  const groups = new Map<string, number[]>();
  edges.forEach((e, idx) => {
    if (e.source === e.target) return;
    const a = e.source < e.target ? e.source : e.target;
    const b = e.source < e.target ? e.target : e.source;
    const key = `${a}::${b}`;
    const list = groups.get(key);
    if (list) list.push(idx);
    else groups.set(key, [idx]);
  });

  const out = new Map<number, LaneAssignment>();
  for (const [, indices] of groups) {
    // Orden determinista: primero dirección canónica source < target, luego por rel/idx
    const sorted = [...indices].sort((ia, ib) => {
      const ea = edges[ia];
      const eb = edges[ib];
      if (!ea || !eb) return ia - ib;
      const dirA = ea.source < ea.target ? 0 : 1;
      const dirB = eb.source < eb.target ? 0 : 1;
      if (dirA !== dirB) return dirA - dirB;
      return (ea.rel ?? ia) - (eb.rel ?? ib);
    });

    const count = sorted.length;
    sorted.forEach((edgeIdx, k) => {
      const offset = count === 1 ? 0 : (k - (count - 1) / 2) * CHANNEL_STEP;
      out.set(edgeIdx, {
        laneIndex: k,
        laneCount: count,
        signedOffset: offset,
      });
    });
  }
  return out;
}

export interface RoutedSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly horizontal: boolean;
  readonly edgeIdx: number;
}

/** Tamaño de celda del índice espacial (grilla hash uniforme). */
const OCC_GRID_CELL = 32;

/** Clave numérica de celda (única para |cx|,|cy| < 2048, de sobra para diagramas). */
function cellKey(cx: number, cy: number): number {
  return cx * 4096 + cy;
}

/**
 * Memoria de segmentos ya ruteados para penalizar cruces perpendiculares (`CROSS_PENALTY = 50`)
 * y solapes colineales (`COLINEAR_OVERLAP_PENALTY` por segmento compartido).
 *
 * Rendimiento: además de la lista plana mantiene un índice espacial (grilla hash uniforme
 * de celda `OCC_GRID_CELL`) para que `evaluateSegment` solo examine los segmentos cercanos
 * en vez de todos (`O(n²)` → `O(n)` amortizado). Los candidatos se reordenan por número de
 * secuencia de inserción antes de evaluar, por lo que los resultados son bit-idénticos
 * a los del barrido lineal.
 */
export class SegmentOccupancy {
  /** Un hueco (`undefined`) es un tramo retirado con `removeEdge`: el índice espacial lo ignora. */
  private readonly segments: (RoutedSegment | undefined)[] = [];
  private readonly grid = new Map<number, number[]>();

  private indexSegment(seq: number, s: RoutedSegment): void {
    const minCX = Math.floor((Math.min(s.x0, s.x1) - 4) / OCC_GRID_CELL);
    const maxCX = Math.floor((Math.max(s.x0, s.x1) + 4) / OCC_GRID_CELL);
    const minCY = Math.floor((Math.min(s.y0, s.y1) - 4) / OCC_GRID_CELL);
    const maxCY = Math.floor((Math.max(s.y0, s.y1) + 4) / OCC_GRID_CELL);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = cellKey(cx, cy);
        const list = this.grid.get(key);
        if (list) list.push(seq);
        else this.grid.set(key, [seq]);
      }
    }
  }

  /** Recolecta los números de secuencia candidatos cuyo bbox (expandido 4px) toca el bbox dado. */
  private queryCandidates(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const minCX = Math.floor((minX - 4) / OCC_GRID_CELL);
    const maxCX = Math.floor((maxX + 4) / OCC_GRID_CELL);
    const minCY = Math.floor((minY - 4) / OCC_GRID_CELL);
    const maxCY = Math.floor((maxY + 4) / OCC_GRID_CELL);
    // Caso rápido: una sola celda (consultas puntuales o tramos cortos alineados a celda)
    if (minCX === maxCX && minCY === maxCY) {
      const list = this.grid.get(cellKey(minCX, minCY));
      if (!list || list.length === 0) return [];
      if (list.length === 1) return [list[0] ?? -1].filter((v) => v >= 0);
    }
    const seen = new Set<number>();
    const out: number[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const list = this.grid.get(cellKey(cx, cy));
        if (!list) continue;
        for (const seq of list) {
          if (!seen.has(seq)) {
            seen.add(seq);
            out.push(seq);
          }
        }
      }
    }
    // Orden de inserción para resultados bit-idénticos al barrido lineal
    out.sort((a, b) => a - b);
    return out;
  }

  public addPolyline(points: readonly number[], edgeIdx: number): void {
    const n = Math.floor(points.length / 2);
    for (let i = 0; i < n - 1; i++) {
      const x0 = points[i * 2] ?? 0;
      const y0 = points[i * 2 + 1] ?? 0;
      const x1 = points[(i + 1) * 2] ?? 0;
      const y1 = points[(i + 1) * 2 + 1] ?? 0;
      if (Math.hypot(x1 - x0, y1 - y0) < EPS) continue;
      const horizontal = Math.abs(y1 - y0) <= Math.abs(x1 - x0);
      const seq = this.segments.length;
      const seg = { x0, y0, x1, y1, horizontal, edgeIdx };
      this.segments.push(seg);
      this.indexSegment(seq, seg);
    }
  }

  /** Retira todos los tramos de una arista (para volver a rutearla conociendo las demás). */
  public removeEdge(edgeIdx: number): void {
    for (let seq = 0; seq < this.segments.length; seq++) {
      if (this.segments[seq]?.edgeIdx === edgeIdx) this.segments[seq] = undefined;
    }
  }

  /** Evalúa cuántos cruces perpendiculares y cuánto solape colineal tiene un tramo candidato. */
  public evaluateSegment(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    excludeEdgeIdx?: number,
  ): { readonly crossings: number; readonly colinearOverlap: number } {
    const horiz = Math.abs(by - ay) < EPS;
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);

    let crossings = 0;
    let colinearOverlap = 0;

    // Solo los segmentos cercanos (índice espacial); el test exacto decide cada caso.
    // El pre-filtro es conservador (superset del barrido lineal): radio 4px de carril
    // colineal + tolerancia de contacto en extremos.
    const candidates = this.queryCandidates(minX - EPS, minY - 4, maxX + EPS, maxY + 4);
    for (const seq of candidates) {
      const s = this.segments[seq];
      if (!s) continue;
      if (excludeEdgeIdx !== undefined && s.edgeIdx === excludeEdgeIdx) continue;
      const sMinX = Math.min(s.x0, s.x1);
      const sMaxX = Math.max(s.x0, s.x1);
      const sMinY = Math.min(s.y0, s.y1);
      const sMaxY = Math.max(s.y0, s.y1);

      if (horiz === s.horizontal) {
        // Misma orientación: comprobar si van por el mismo carril (< 4 px) y se solapan.
        // El solape cuenta 1 por segmento compartido (no proporcional a la longitud):
        // así COLINEAR_OVERLAP_PENALTY es un coste acotado por segmento y el A* poda bien.
        if (horiz) {
          if (Math.abs(ay - s.y0) < 4) {
            const ov = Math.min(maxX, sMaxX) - Math.max(minX, sMinX);
            if (ov > -EPS) colinearOverlap += 1;
          }
        } else {
          if (Math.abs(ax - s.x0) < 4) {
            const ov = Math.min(maxY, sMaxY) - Math.max(minY, sMinY);
            if (ov > -EPS) colinearOverlap += 1;
          }
        }
      } else {
        // Orientación perpendicular: comprobar cruce
        if (horiz) {
          if (s.x0 >= minX + EPS && s.x0 <= maxX - EPS && ay >= sMinY + EPS && ay <= sMaxY - EPS) {
            crossings += 1;
          }
        } else {
          if (ax >= sMinX + EPS && ax <= sMaxX - EPS && s.y0 >= minY + EPS && s.y0 <= maxY - EPS) {
            crossings += 1;
          }
        }
      }
    }

    return { crossings, colinearOverlap };
  }
}