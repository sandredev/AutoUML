// src/presentation/diagram/canvas/overrides.ts — posiciones movidas a mano sobre un layout (puro, sin DOM/React).
// Un override es un desplazamiento (dx, dy) respecto a la posición que calculó el layout.
// Así "Restablecer" es simplemente vaciar el mapa: las tarjetas vuelven a la posición del layout.
import { simplify } from './edgePath';
import { PKG_HINT_PREFIX } from '../layout/stability';
import {
  computeDiagramBounds,
  EPS,
  fitPackageBoxes,
  openPackageChannels,
  rerouteAffectedEdges,
  routeAllEdges,
} from '../routing';
import type { EdgePath, LayoutResult, NodeBox, NoteBox, PackageBox } from '../types';

export interface Offset {
  dx: number;
  dy: number;
}
export type Overrides = ReadonlyMap<string, Offset>;

export const EMPTY_OVERRIDES: Overrides = new Map();

/**
 * Por encima de este número de aristas, el ruteo completo al soltar costaría demasiado en el hilo principal
 * y se mantiene el reruteo incremental también en reposo.
 */
export const SETTLED_FULL_REROUTE_MAX_EDGES = 400;

/** Suma (dx, dy) al desplazamiento de una tarjeta o paquete. Devuelve un mapa nuevo. */
export function moveBy(overrides: Overrides, id: string, dx: number, dy: number): Overrides {
  const prev = overrides.get(id);
  const next = new Map(overrides);
  next.set(id, { dx: (prev?.dx ?? 0) + dx, dy: (prev?.dy ?? 0) + dy });
  return next;
}

/** Suma (dx, dy) al desplazamiento de varias tarjetas (arrastre de una selección múltiple). Mapa nuevo. */
export function moveAll(overrides: Overrides, ids: Iterable<string>, dx: number, dy: number): Overrides {
  const next = new Map(overrides);
  for (const id of ids) {
    const prev = next.get(id);
    next.set(id, { dx: (prev?.dx ?? 0) + dx, dy: (prev?.dy ?? 0) + dy });
  }
  return next;
}

/** Fija el desplazamiento de una tarjeta. Devuelve un mapa nuevo. */
export function setOverride(overrides: Overrides, id: string, offset: Offset): Overrides {
  const next = new Map(overrides);
  next.set(id, { dx: offset.dx, dy: offset.dy });
  return next;
}

/** Quita todos los desplazamientos (posición original del layout). */
export function clearOverrides(): Overrides {
  return EMPTY_OVERRIDES;
}

/**
 * Migra los desplazamientos a un layout nuevo del MISMO documento (recarga, plegado, hide): se
 * conservan los de los ids que siguen existiendo. Si no se pierde ninguno devuelve el mismo mapa.
 */
export function retainOverrides(overrides: Overrides, ids: Iterable<string>): Overrides {
  if (overrides.size === 0) return overrides;
  const keep = new Set(ids);
  let dropped = false;
  const next = new Map<string, Offset>();
  for (const [id, o] of overrides) {
    if (keep.has(id)) next.set(id, o);
    else dropped = true;
  }
  if (!dropped) return overrides;
  return next.size === 0 ? EMPTY_OVERRIDES : next;
}

export function hasOverrides(overrides: Overrides): boolean {
  for (const o of overrides.values()) if (Math.abs(o.dx) > EPS || Math.abs(o.dy) > EPS) return true;
  return false;
}

/**
 * Aplica los desplazamientos al layout sin mutarlo:
 * - mueve las tarjetas (y soporta mover paquetes rígidos vía `pkg::<nombre>`);
 * - ciñe estrictamente cada paquete a sus miembros (`envelope(nodes) + PKG_PAD`), sin dejar aire;
 * - si un paquete o pasillo queda bloqueado, desplaza el paquete vecino como bloque rígido;
 * - rerutea ortogonalmente las aristas afectadas reasignando puertos y carriles;
 * - recalcula bounds.
 *
 * `settled`: el usuario no está arrastrando (posiciones cargadas, arrastre terminado, exportación). Entonces
 * se rutean TODAS las aristas ortogonales desde cero sobre la geometría final, con el router de calidad: el
 * reruteo incremental (rápido, para los 16 ms del arrastre) conserva rutas del layout base que ya no
 * encajan con las posiciones movidas y deja tramos que cruzan tarjetas.
 */
export function applyOverrides(
  layout: LayoutResult,
  overrides: Overrides,
  opts?: { readonly settled?: boolean },
): LayoutResult {
  if (!hasOverrides(overrides)) return layout;

  const rawOff = (id: string): Offset | undefined => {
    const o = overrides.get(id);
    return o && (Math.abs(o.dx) > EPS || Math.abs(o.dy) > EPS) ? o : undefined;
  };

  const effectiveOffsets = new Map<string, Offset>();
  const movedNodeIds = new Set<string>();

  const baseNodes: NodeBox[] = layout.nodes.map((n) => {
    const direct = rawOff(n.id);
    const pkgOff =
      n.packageName !== undefined
        ? rawOff(PKG_HINT_PREFIX + n.packageName) ?? rawOff(n.packageName)
        : undefined;
    const dx = (direct?.dx ?? 0) + (pkgOff?.dx ?? 0);
    const dy = (direct?.dy ?? 0) + (pkgOff?.dy ?? 0);
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) {
      movedNodeIds.add(n.id);
      effectiveOffsets.set(n.id, { dx, dy });
      return { ...n, x: n.x + dx, y: n.y + dy };
    }
    return n;
  });

  // Las notas ancladas acompañan a su clase (más su propio override si lo tuvieran).
  let baseNotes: NoteBox[] | undefined = layout.notes;
  if (baseNotes) {
    baseNotes = baseNotes.map((n) => {
      const anchorOff = n.anchor !== undefined ? effectiveOffsets.get(n.anchor) : undefined;
      const direct = rawOff(n.id);
      const dx = (anchorOff?.dx ?? 0) + (direct?.dx ?? 0);
      const dy = (anchorOff?.dy ?? 0) + (direct?.dy ?? 0);
      return Math.abs(dx) > EPS || Math.abs(dy) > EPS ? { ...n, x: n.x + dx, y: n.y + dy } : n;
    });
  }

  // Ceñir estrictamente los paquetes a sus miembros actuales (envelope + PKG_PAD)
  const tightPackages: PackageBox[] = fitPackageBoxes(layout.packages, baseNodes);

  // Si falta canal entre paquetes o se solapan tras el movimiento, abrir canal moviendo el paquete rígido
  const channelFit = openPackageChannels(baseNodes, tightPackages, layout.edges, baseNotes);
  for (const pid of channelFit.pushedNodeIds) {
    movedNodeIds.add(pid);
    const orig = layout.nodes.find((n) => n.id === pid);
    const curr = channelFit.nodes.find((n) => n.id === pid);
    if (orig && curr) {
      effectiveOffsets.set(pid, { dx: curr.x - orig.x, dy: curr.y - orig.y });
    }
  }

  const finalNodes = channelFit.nodes;
  const finalPackages = channelFit.packages;
  const finalNotes = channelFit.notes;

  const incremental: EdgePath[] = rerouteAffectedEdges(
    finalNodes,
    finalPackages,
    layout.edges,
    movedNodeIds,
    effectiveOffsets,
    finalNotes ?? [],
  );
  // Las polilíneas (dagre) ya vienen desplazadas por el reruteo incremental: routeAllEdges las conserva.
  const edges: EdgePath[] =
    opts?.settled && layout.edges.length <= SETTLED_FULL_REROUTE_MAX_EDGES
      ? routeAllEdges(finalNodes, finalPackages, incremental, finalNotes ?? [])
      : incremental;

  const bounds = computeDiagramBounds(
    finalNodes,
    [...finalPackages, ...(finalNotes ?? [])],
    edges,
    layout.bounds,
  );

  const out: LayoutResult = { nodes: finalNodes, edges, packages: finalPackages, bounds };
  if (finalNotes) out.notes = finalNotes;
  return out;
}

/**
 * Mueve el primer punto de una polilínea garantizando ortogonalidad y evasión de cajas.
 * Se conserva por compatibilidad con tests unitarios directos; `applyOverrides` usa `rerouteAffectedEdges`.
 */
export function moveStart(points: readonly number[], o: Offset, ortho: boolean, obstacles?: readonly Box[]): number[] {
  if (points.length < 4) return points.slice();
  const sx = (points[0] ?? 0) + o.dx;
  const sy = (points[1] ?? 0) + o.dy;
  const rest = points.slice(2);
  if (!ortho) return [sx, sy, ...rest];
  const nx = rest[0] ?? 0;
  const ny = rest[1] ?? 0;
  const vertical = Math.abs((points[0] ?? 0) - nx) < EPS;
  const first: [number, number] = vertical ? [sx, ny] : [nx, sy];
  if (!obstacles || obstacles.length === 0) return simplify([sx, sy, ...first, ...rest]);
  const alt: [number, number] = vertical ? [nx, sy] : [sx, ny];
  const crosses = (elbow: readonly [number, number]): number => {
    let n = 0;
    const segs: ReadonlyArray<readonly [number, number, number, number]> = [
      [sx, sy, elbow[0], elbow[1]],
      [elbow[0], elbow[1], nx, ny],
    ];
    for (const [x1, y1, x2, y2] of segs) {
      for (const box of obstacles) {
        if (segCrossesBox(x1, y1, x2, y2, box)) n += 1;
      }
    }
    return n;
  };
  const elbow = crosses(alt) < crosses(first) ? alt : first;
  return simplify([sx, sy, ...elbow, ...rest]);
}

/** Caja para el re-ruteo (una tarjeta ya movida). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function strictlyInside(px: number, py: number, b: Box): boolean {
  return px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return (
    Math.min(ax, cx) - EPS <= bx &&
    bx <= Math.max(ax, cx) + EPS &&
    Math.min(ay, cy) - EPS <= by &&
    by <= Math.max(ay, cy) + EPS
  );
}

function segsCross(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): boolean {
  const d1 = orient(x3, y3, x4, y4, x1, y1);
  const d2 = orient(x3, y3, x4, y4, x2, y2);
  const d3 = orient(x1, y1, x2, y2, x3, y3);
  const d4 = orient(x1, y1, x2, y2, x4, y4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (Math.abs(d1) < EPS && onSegment(x3, y3, x1, y1, x4, y4)) return true;
  if (Math.abs(d2) < EPS && onSegment(x3, y3, x2, y2, x4, y4)) return true;
  if (Math.abs(d3) < EPS && onSegment(x1, y1, x3, y3, x2, y2)) return true;
  if (Math.abs(d4) < EPS && onSegment(x1, y1, x4, y4, x2, y2)) return true;
  return false;
}

function segCrossesBox(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  if (Math.hypot(x2 - x1, y2 - y1) < EPS) return false;
  if (strictlyInside(x1, y1, b) || strictlyInside(x2, y2, b)) return true;
  const x0 = b.x, y0 = b.y, x3 = b.x + b.w, y3 = b.y + b.h;
  return (
    segsCross(x1, y1, x2, y2, x0, y0, x3, y0) ||
    segsCross(x1, y1, x2, y2, x3, y0, x3, y3) ||
    segsCross(x1, y1, x2, y2, x3, y3, x0, y3) ||
    segsCross(x1, y1, x2, y2, x0, y3, x0, y0)
  );
}

/** Convierte el record del sidecar a Overrides (filtra valores no finitos). */
export function overridesFromRecord(record: Record<string, { dx: number; dy: number }>): Overrides {
  const next = new Map<string, Offset>();
  if (record === null || typeof record !== 'object') return EMPTY_OVERRIDES;
  for (const [id, o] of Object.entries(record)) {
    if (typeof o?.dx !== 'number' || typeof o?.dy !== 'number') continue;
    if (!Number.isFinite(o.dx) || !Number.isFinite(o.dy)) continue;
    next.set(id, { dx: o.dx, dy: o.dy });
  }
  return next.size === 0 ? EMPTY_OVERRIDES : next;
}

/** Convierte Overrides al record del sidecar (copias, listo para JSON). */
export function overridesToRecord(overrides: Overrides): Record<string, { dx: number; dy: number }> {
  const out: Record<string, { dx: number; dy: number }> = {};
  for (const [id, o] of overrides) out[id] = { dx: o.dx, dy: o.dy };
  return out;
}
