import type { LayoutResult, DiagramEdgeLayout, DiagramNodeLayout, Point2D } from '../types';
import { queryEdges, type SpatialIndex } from './spatial';

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export function distToPolyline(pts: readonly number[], x: number, y: number): number {
  if (pts.length === 2) return Math.hypot(x - (pts[0] ?? 0), y - (pts[1] ?? 0));
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    best = Math.min(best, distToSegment(x, y, pts[k] ?? 0, pts[k + 1] ?? 0, pts[k + 2] ?? 0, pts[k + 3] ?? 0));
  }
  return best;
}

/**
 * Índice de la arista más cercana a (x, y) a distancia ≤ tolWorld, o null. Pasa tolPx / scale para
 * tener la tolerancia en píxeles de pantalla. Con `index` solo se miran las aristas cuya caja toca el
 * cuadrado de búsqueda (índice espacial); sin él, todas.
 */
export function hitTestEdge(
  layout: LayoutResult,
  x: number,
  y: number,
  tolWorld: number,
  index?: SpatialIndex,
): number | null {
  const candidates: Iterable<number> = index
    ? queryEdges(index, { x: x - tolWorld, y: y - tolWorld, w: 2 * tolWorld, h: 2 * tolWorld })
    : layout.edges.keys();
  let best: number | null = null;
  let bestD = tolWorld;
  for (const i of candidates) {
    const e = layout.edges[i];
    if (!e) continue;
    const d = distToPolyline(e.points, x, y);
    // Con empate gana la última (se dibuja encima).
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export type EdgeHitResult =
  | { kind: 'source-handle'; edgeId: string; point: Point2D }
  | { kind: 'target-handle'; edgeId: string; point: Point2D }
  | { kind: 'waypoint'; edgeId: string; waypointIndex: number; point: Point2D }
  | {
      kind: 'segment';
      edgeId: string;
      segmentIndex: number;
      orientation: 'H' | 'V';
      projection: Point2D;
    };

export function hitTestDiagramEdges(
  worldX: number,
  worldY: number,
  edges: DiagramEdgeLayout[],
  zoom: number
): EdgeHitResult | null {
  const invZoom = Math.max(0.5, Math.min(2.2, 1 / zoom));
  const handleTol = 9 * invZoom;
  const waypointTol = 7 * invZoom;
  const segmentTol = 6 * invZoom;

  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i];
    const pts = edge.points;
    if (pts.length < 2) continue;

    if (Math.hypot(worldX - pts[0].x, worldY - pts[0].y) <= handleTol) {
      return { kind: 'source-handle', edgeId: edge.id, point: pts[0] };
    }

    const last = pts[pts.length - 1];
    if (Math.hypot(worldX - last.x, worldY - last.y) <= handleTol) {
      return { kind: 'target-handle', edgeId: edge.id, point: last };
    }

    for (let w = 1; w < pts.length - 1; w++) {
      if (Math.hypot(worldX - pts[w].x, worldY - pts[w].y) <= waypointTol) {
        return { kind: 'waypoint', edgeId: edge.id, waypointIndex: w, point: pts[w] };
      }
    }

    for (let s = 0; s < pts.length - 1; s++) {
      const p1 = pts[s];
      const p2 = pts[s + 1];
      const proj = projectOnSegment(worldX, worldY, p1, p2);
      if (proj.distance <= segmentTol) {
        const isH = Math.abs(p2.y - p1.y) <= Math.abs(p2.x - p1.x);
        return {
          kind: 'segment',
          edgeId: edge.id,
          segmentIndex: s,
          orientation: isH ? 'H' : 'V',
          projection: { x: proj.x, y: proj.y },
        };
      }
    }
  }
  return null;
}

/**
 * Desliza un segmento ortogonalmente. Si es el primer o último segmento,
 * crea un codo automático para no despegar el extremo de la entidad.
 */
export function moveOrthogonalSegment(
  points: Point2D[],
  segmentIndex: number,
  targetWorldX: number,
  targetWorldY: number
): { points: Point2D[]; activeSegmentIndex: number } {
  const pts = points.map((p) => ({ ...p }));
  if (pts.length < 2) return { points: pts, activeSegmentIndex: segmentIndex };

  let idx = segmentIndex;
  const p1 = pts[idx];
  const p2 = pts[idx + 1];
  const isHorizontal = Math.abs(p2.y - p1.y) <= Math.abs(p2.x - p1.x);

  if (idx === 0) {
    pts.splice(1, 0, { x: p1.x, y: p1.y });
    idx = 1;
  }
  if (idx === pts.length - 2) {
    const end = pts[pts.length - 1];
    pts.splice(pts.length - 1, 0, { x: end.x, y: end.y });
  }

  if (isHorizontal) {
    pts[idx].y = targetWorldY;
    pts[idx + 1].y = targetWorldY;
  } else {
    pts[idx].x = targetWorldX;
    pts[idx + 1].x = targetWorldX;
  }

  return { points: pts, activeSegmentIndex: idx };
}

/**
 * Parte/dobla un segmento recto insertando un escalón ortogonal en (splitX, splitY).
 */
export function splitEdgeSegmentAt(
  points: Point2D[],
  segmentIndex: number,
  splitX: number,
  splitY: number
): { points: Point2D[]; newSegmentIndex: number } {
  const pts = points.map((p) => ({ ...p }));
  const p1 = pts[segmentIndex];
  const p2 = pts[segmentIndex + 1];
  const isHorizontal = Math.abs(p2.y - p1.y) <= Math.abs(p2.x - p1.x);

  if (isHorizontal) {
    pts.splice(segmentIndex + 1, 0, { x: splitX, y: p1.y }, { x: splitX, y: p2.y });
  } else {
    pts.splice(segmentIndex + 1, 0, { x: p1.x, y: splitY }, { x: p2.x, y: splitY });
  }

  return { points: pts, newSegmentIndex: segmentIndex + 2 };
}

/**
 * Elimina un codo intermedio (doble clic sobre el codo) y recompone los 90°.
 */
export function deleteEdgeWaypoint(points: Point2D[], waypointIndex: number): Point2D[] {
  if (points.length <= 2 || waypointIndex <= 0 || waypointIndex >= points.length - 1) {
    return points;
  }
  const pts = points.map((p) => ({ ...p }));
  pts.splice(waypointIndex, 1);
  const prev = pts[waypointIndex - 1];
  const next = pts[waypointIndex];
  if (Math.abs(prev.x - next.x) > 1 && Math.abs(prev.y - next.y) > 1) {
    pts[waypointIndex] = { x: next.x, y: prev.y };
  }
  return simplifyOrthogonalPolyline(pts);
}

/**
 * Fusiona segmentos colineales redundantes tras arrastrar una arista.
 */
export function simplifyOrthogonalPolyline(points: Point2D[], snapTol = 3): Point2D[] {
  if (points.length <= 2) return points;
  const out: Point2D[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const curr = { ...points[i] };
    const next = points[i + 1];

    if (Math.abs(curr.x - prev.x) < snapTol) curr.x = prev.x;
    if (Math.abs(curr.y - prev.y) < snapTol) curr.y = prev.y;

    const collinearX = Math.abs(prev.x - curr.x) < 1 && Math.abs(curr.x - next.x) < 1;
    const collinearY = Math.abs(prev.y - curr.y) < 1 && Math.abs(curr.y - next.y) < 1;
    if (!collinearX && !collinearY) {
      out.push(curr);
    }
  }

  out.push(points[points.length - 1]);
  return out;
}

/**
 * Ajusta el punto extremo de una relación al borde de la entidad conectada.
 */
export function clampEndpointToNode(node: DiagramNodeLayout, refPoint: Point2D): Point2D {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = refPoint.x - cx;
  const dy = refPoint.y - cy;

  if (Math.abs(dx / node.width) > Math.abs(dy / node.height)) {
    return {
      x: dx >= 0 ? node.x + node.width : node.x,
      y: Math.max(node.y + 10, Math.min(node.y + node.height - 10, refPoint.y)),
    };
  }
  return {
    x: Math.max(node.x + 10, Math.min(node.x + node.width - 10, refPoint.x)),
    y: dy >= 0 ? node.y + node.height : node.y,
  };
}

/**
 * Devuelve los IDs de todas las aristas intersectadas por el trazo de cuchilla (A -> B).
 */
export function getEdgesIntersectedByKnife(
  knifeStart: Point2D,
  knifeEnd: Point2D,
  edges: DiagramEdgeLayout[]
): string[] {
  const cutIds: string[] = [];
  for (const edge of edges) {
    for (let i = 0; i < edge.points.length - 1; i++) {
      if (doSegmentsIntersect(knifeStart, knifeEnd, edge.points[i], edge.points[i + 1])) {
        cutIds.push(edge.id);
        break;
      }
    }
  }
  return cutIds;
}

function projectOnSegment(px: number, py: number, a: Point2D, b: Point2D) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { x: a.x, y: a.y, distance: Math.hypot(px - a.x, py - a.y) };
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { x, y, distance: Math.hypot(px - x, py - y) };
}

function doSegmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const ccw = (p1: Point2D, p2: Point2D, p3: Point2D) =>
    (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}
