// src/presentation/diagram/routing/nudge.ts — reparto de tramos en sus pasillos tras el ruteo (puro, sin DOM/React).
//
// El router decide la topología de cada arista (por qué caras sale y por qué pasillos va), pero coloca
// los tramos en el primer carril libre que encuentra: pegados a 2px de una tarjeta, sobre el borde de un
// paquete o amontonados en un lado del pasillo. Este paso desliza cada tramo en perpendicular a sí mismo
// (sin cambiar la topología) para:
// - separarlo de tarjetas y bordes de paquete (centrarlo si el pasillo es estrecho);
// - repartir a distancias iguales los tramos paralelos que comparten pasillo, conservando su orden
//   (así no se crean cruces entre ellos).
// Los tramos de puerto (primero y último) también se deslizan, moviendo el puerto a lo largo de su cara
// sin acercarse a las esquinas. Cada movimiento se valida contra los obstáculos antes de aplicarlo.
import type { EdgePath, NodeBox, NoteBox, PackageBox, DiagramEdgeLayout, DiagramNodeLayout, Point2D } from '../types';
import { EPS } from './constants';
import type { RectBox } from './ports';

/** Distancia deseada entre un tramo y una tarjeta o borde de paquete. */
const CLEARANCE = 14;
/** Separación máxima entre tramos paralelos de un mismo pasillo. */
const STEP_MAX = 14;
/** Longitud mínima de un tramo interior que se acorta al mover su vecino. */
const MIN_LEG = 8;
/** Longitud mínima del tramo de puerto (sale perpendicular de la tarjeta). */
const MIN_STUB = 12;
/** Distancia mínima de un puerto a la esquina de su tarjeta. */
const PORT_INSET = 12;
/** Un pasillo más ancho que esto no centra un tramo solitario: solo lo separa de los obstáculos. */
const NARROW = 90;

interface Seg {
  readonly e: number;
  readonly i: number;
  readonly horiz: boolean;
  /** Coordenada perpendicular actual (y si es horizontal, x si es vertical). */
  readonly c: number;
  /** Extensión a lo largo del tramo. */
  readonly a: number;
  readonly b: number;
  /** Hueco libre de obstáculos (sin holgura). */
  readonly olo: number;
  readonly ohi: number;
  /** Rango duro: obstáculos (2px), puertos y vecinos de puerto. */
  readonly lo: number;
  readonly hi: number;
  /**
   * Zonas prohibidas alrededor del extremo lejano de cada vecino interior: el tramo puede pasar al otro
   * lado (el vecino solo cambia de sentido), pero no dejar al vecino más corto que MIN_LEG.
   */
  readonly zones: readonly (readonly [number, number])[];
}

/** Rango duro de un tramo para ir hacia `target`: cada zona prohibida se rodea por el lado del objetivo. */
function rangeToward(s: Seg, target: number): [number, number] {
  const pick = (towardHigh: (z: readonly [number, number]) => boolean): [number, number] => {
    let lo = s.lo;
    let hi = s.hi;
    for (const z of s.zones) {
      if (towardHigh(z)) lo = Math.max(lo, z[1]);
      else hi = Math.min(hi, z[0]);
    }
    return [lo, hi];
  };
  const wanted = pick((z) => target >= (z[0] + z[1]) / 2);
  if (wanted[0] <= wanted[1] + EPS) return wanted;
  // Sin hueco hacia el objetivo: quedarse del lado en que ya está.
  const current = pick((z) => s.c >= (z[0] + z[1]) / 2);
  return current[0] <= current[1] + EPS ? current : [s.c, s.c];
}

interface Ctx {
  readonly boxes: readonly (RectBox & { readonly id?: string })[];
  readonly packages: readonly PackageBox[];
  readonly nodeById: ReadonlyMap<string, NodeBox>;
}

function segCount(pts: readonly number[]): number {
  return Math.floor(pts.length / 2) - 1;
}

function px(pts: readonly number[], k: number): number {
  return pts[k * 2] ?? 0;
}

function py(pts: readonly number[], k: number): number {
  return pts[k * 2 + 1] ?? 0;
}

/** Hueco libre [lo, hi] de la coordenada perpendicular de un tramo, según tarjetas, notas y paquetes. */
function freeInterval(
  horiz: boolean,
  c: number,
  a: number,
  b: number,
  ownIds: ReadonlySet<string>,
  ctx: Ctx,
): [number, number] | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const o of ctx.boxes) {
    if (o.id !== undefined && ownIds.has(o.id)) continue;
    const s0 = horiz ? o.x : o.y;
    const s1 = horiz ? o.x + o.w : o.y + o.h;
    if (s1 <= a - 1 || s0 >= b + 1) continue;
    const p0 = horiz ? o.y : o.x;
    const p1 = horiz ? o.y + o.h : o.x + o.w;
    if (p1 <= c + EPS) lo = Math.max(lo, p1);
    else if (p0 >= c - EPS) hi = Math.min(hi, p0);
    else return null; // el tramo ya está dentro de un obstáculo: no se toca
  }
  // Bordes de paquete: un tramo paralelo no debe cruzarlos ni ir pegado a ellos
  for (const p of ctx.packages) {
    const s0 = horiz ? p.x : p.y;
    const s1 = horiz ? p.x + p.w : p.y + p.h;
    if (s1 <= a - 1 || s0 >= b + 1) continue;
    for (const line of horiz ? [p.y, p.y + p.h] : [p.x, p.x + p.w]) {
      if (line <= c + EPS) lo = Math.max(lo, line);
      else hi = Math.min(hi, line);
    }
  }
  return [lo, hi];
}

function buildSegments(edges: readonly EdgePath[], pts: readonly (number[] | null)[], horizPass: boolean, ctx: Ctx): Seg[] {
  const out: Seg[] = [];
  edges.forEach((e, ei) => {
    const p = pts[ei];
    if (!p) return;
    const n = segCount(p);
    for (let i = 0; i < n; i++) {
      const x0 = px(p, i), y0 = py(p, i), x1 = px(p, i + 1), y1 = py(p, i + 1);
      const horiz = Math.abs(y1 - y0) < EPS;
      if (horiz !== horizPass) continue;
      if (!horiz && Math.abs(x1 - x0) > EPS) continue; // tramo no ortogonal: no se toca
      const c = horiz ? y0 : x0;
      const a = horiz ? Math.min(x0, x1) : Math.min(y0, y1);
      const b = horiz ? Math.max(x0, x1) : Math.max(y0, y1);
      if (b - a < EPS) continue;

      // Los tramos de puerto atraviesan legalmente el borde de su tarjeta: se excluye del test de huecos.
      const own = new Set<string>();
      if (i === 0) own.add(e.source);
      if (i === n - 1) own.add(e.target);
      const free = freeInterval(horiz, c, a, b, own, ctx);
      if (!free) continue;
      const [olo, ohi] = free;

      // Vecinos: si el vecino es un tramo de puerto, este tramo no puede pasar al otro lado de su extremo
      // (entraría en la tarjeta) ni acortarlo por debajo de MIN_STUB. Si es interior, puede cruzarlo (el
      // vecino solo cambia de sentido) pero no dejarlo más corto que MIN_LEG: zona prohibida alrededor.
      let nlo = -Infinity;
      let nhi = Infinity;
      const zones: [number, number][] = [];
      const neighbor = (k: number, isStub: boolean): void => {
        const far = horiz ? py(p, k) : px(p, k);
        const d = c - far;
        const min = Math.min(Math.abs(d), isStub ? MIN_STUB : MIN_LEG);
        if (!isStub) zones.push([far - min, far + min]);
        else if (d > 0) nlo = Math.max(nlo, far + min);
        else nhi = Math.min(nhi, far - min);
      };
      if (i > 0) neighbor(i - 1, i - 1 === 0);
      if (i < n - 1) neighbor(i + 2, i + 1 === n - 1);

      // Tramo de puerto: desplazarlo mueve el puerto a lo largo de su cara, lejos de las esquinas.
      for (const box of [i === 0 ? ctx.nodeById.get(e.source) : undefined, i === n - 1 ? ctx.nodeById.get(e.target) : undefined]) {
        if (!box) continue;
        const s0 = horiz ? box.y : box.x;
        const s1 = horiz ? box.y + box.h : box.x + box.w;
        const inset = Math.min(PORT_INSET, (s1 - s0) / 2 - 1);
        nlo = Math.max(nlo, s0 + inset);
        nhi = Math.min(nhi, s1 - inset);
      }

      // Rango duro: no tocar obstáculos (2px) ni romper vecinos/puertos. La holgura deseada respecto a los
      // obstáculos la aplica el reparto del grupo entero (targetPositions), no cada tramo por separado.
      let lo = Math.max(olo + 2, nlo);
      let hi = Math.min(ohi - 2, nhi);
      if (lo > hi + EPS) {
        lo = c;
        hi = c;
      }
      out.push({ e: ei, i, horiz, c, a, b, olo, ohi, lo, hi, zones });
    }
  });
  return out;
}

/** Agrupa tramos paralelos que comparten pasillo: se solapan a lo largo y ninguno tiene un obstáculo entre ambos. */
function groupSegments(segs: readonly Seg[]): Seg[][] {
  const parent = segs.map((_, k) => k);
  const find = (k: number): number => {
    while (parent[k] !== k) {
      parent[k] = parent[parent[k] ?? k] ?? k;
      k = parent[k] ?? k;
    }
    return k;
  };
  const order = segs.map((_, k) => k).sort((p, q) => (segs[p]?.c ?? 0) - (segs[q]?.c ?? 0));
  for (let x = 0; x < order.length; x++) {
    const s = segs[order[x] ?? 0];
    if (!s) continue;
    for (let y = x + 1; y < order.length; y++) {
      const t = segs[order[y] ?? 0];
      if (!t) continue;
      if (t.c > s.ohi + EPS) break; // ordenados por c: los siguientes quedan al otro lado de un obstáculo
      if (!sameCorridor(s, t)) continue;
      const ra = find(order[x] ?? 0);
      const rb = find(order[y] ?? 0);
      if (ra !== rb) parent[rb] = ra;
    }
  }
  const groups = new Map<number, Seg[]>();
  segs.forEach((s, k) => {
    const r = find(k);
    const g = groups.get(r);
    if (g) g.push(s);
    else groups.set(r, [s]);
  });
  return [...groups.values()];
}

/** ¿Comparten pasillo dos tramos paralelos? (Se solapan a lo largo y cada uno está en el hueco del otro.) */
function sameCorridor(s: Seg, t: Seg): boolean {
  if (Math.min(s.b, t.b) - Math.max(s.a, t.a) <= EPS) return false;
  return t.c >= s.olo - EPS && t.c <= s.ohi + EPS && s.c >= t.olo - EPS && s.c <= t.ohi + EPS;
}

/**
 * Ajuste isotónico con separación mínima: minimiza Σ(p_j − t_j)² con p_{j+1} − p_j ≥ gap (orden fijo).
 * Con q_j = p_j − j·gap queda una regresión isotónica no decreciente (pool adjacent violators): el reparto
 * es simétrico alrededor de los objetivos que chocan, en vez de empujar todo hacia un lado.
 */
function isotonicWithGap(t: readonly number[], gap: number): number[] {
  const blocks: { sum: number; n: number }[] = [];
  t.forEach((v, j) => {
    blocks.push({ sum: v - j * gap, n: 1 });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let r = 0; r < b.n; r++) out.push(b.sum / b.n + out.length * gap);
  return out;
}

/**
 * Posiciones objetivo de los tramos de un grupo (entran ordenados por c y salen en el mismo orden).
 * Objetivo de cada tramo según SU pasillo (hueco entre obstáculos):
 * - estrecho (no caben con holgura los tramos que lo comparten): el centro del pasillo;
 * - ancho: donde ya está, pero a CLEARANCE de las paredes.
 * Los objetivos que chocan se separan con un ajuste isotónico (mínimo desplazamiento, orden conservado)
 * a la mayor separación que permita el pasillo más apretado, y se proyectan sobre el rango duro de cada uno.
 */
function targetPositions(group: readonly Seg[]): number[] {
  const k = group.length;
  let gapMax = STEP_MAX;
  const ideal = group.map((s) => {
    const width = s.ohi - s.olo;
    if (!Number.isFinite(width)) return s.c;
    const sharing = group.filter((t) => t === s || sameCorridor(s, t)).length;
    gapMax = Math.min(gapMax, width / (sharing + 1));
    const narrow = width <= NARROW || (sharing + 1) * STEP_MAX >= width;
    if (narrow) return (s.olo + s.ohi) / 2;
    const clr = Math.min(CLEARANCE, width / 2);
    return Math.min(Math.max(s.c, s.olo + clr), s.ohi - clr);
  });
  const ranges = group.map((s, j) => rangeToward(s, ideal[j] ?? s.c));
  const clampJ = (v: number, j: number): number => Math.min(Math.max(v, ranges[j]?.[0] ?? v), ranges[j]?.[1] ?? v);
  if (k === 1) return [clampJ(ideal[0] ?? 0, 0)];

  for (let gap = Math.max(gapMax, 1); gap >= 1; gap = gap > 2 ? gap / 2 : gap - 1) {
    const p = isotonicWithGap(ideal, gap).map(clampJ);
    // El recorte a los rangos duros puede volver a juntar tramos: se corrige y se verifica.
    for (let j = 1; j < k; j++) p[j] = Math.max(p[j] ?? 0, (p[j - 1] ?? 0) + gap);
    for (let j = k - 2; j >= 0; j--) p[j] = Math.min(p[j] ?? 0, (p[j + 1] ?? 0) - gap);
    const ok = p.every((v, j) => v >= (ranges[j]?.[0] ?? v) - EPS && v <= (ranges[j]?.[1] ?? v) + EPS);
    if (ok) return p;
  }
  // Sin reparto posible: cada tramo se queda en su sitio (dentro de su rango duro).
  return group.map((s, j) => clampJ(s.c, j));
}

/** ¿El tramo (x0,y0)-(x1,y1) entra en alguna caja (excepto las propias en los tramos de puerto)? */
function segmentBlocked(
  x0: number, y0: number, x1: number, y1: number,
  own: ReadonlySet<string>,
  ctx: Ctx,
): boolean {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  for (const o of ctx.boxes) {
    if (o.id !== undefined && own.has(o.id)) continue;
    if (maxX > o.x + EPS && minX < o.x + o.w - EPS && maxY > o.y + EPS && minY < o.y + o.h - EPS) return true;
  }
  return false;
}

/** Aplica el nuevo valor de un tramo si la ruta resultante sigue siendo válida. */
function tryMove(e: EdgePath, pts: number[], i: number, horiz: boolean, value: number, ctx: Ctx): boolean {
  const n = segCount(pts);
  const k0 = i;
  const k1 = i + 1;
  const old0 = horiz ? py(pts, k0) : px(pts, k0);
  if (Math.abs(old0 - value) < 0.5) return false;
  const next = pts.slice();
  const coord = horiz ? 1 : 0;
  next[k0 * 2 + coord] = value;
  next[k1 * 2 + coord] = value;

  // Validar el tramo movido y sus dos vecinos
  for (let s = Math.max(0, i - 1); s <= Math.min(n - 1, i + 1); s++) {
    const x0 = px(next, s), y0 = py(next, s), x1 = px(next, s + 1), y1 = py(next, s + 1);
    const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    const isStub = s === 0 || s === n - 1;
    if (s !== i && len < Math.min(isStub ? MIN_STUB : MIN_LEG, lenOf(pts, s)) - EPS) return false;
    const own = new Set<string>();
    if (s === 0) own.add(e.source);
    if (s === n - 1) own.add(e.target);
    if (segmentBlocked(x0, y0, x1, y1, own, ctx)) return false;
  }
  // Los extremos deben seguir sobre el borde de su tarjeta (los tramos de puerto solo se deslizan por la cara)
  for (const [k, id] of [[0, e.source], [n, e.target]] as const) {
    const box = ctx.nodeById.get(id);
    if (!box) continue;
    const x = px(next, k), y = py(next, k);
    if (x < box.x - EPS || x > box.x + box.w + EPS || y < box.y - EPS || y > box.y + box.h + EPS) return false;
  }
  for (let q = 0; q < next.length; q++) pts[q] = next[q] ?? 0;
  return true;
}

function lenOf(pts: readonly number[], s: number): number {
  return Math.abs(px(pts, s + 1) - px(pts, s)) + Math.abs(py(pts, s + 1) - py(pts, s));
}

/**
 * Reparte los tramos de las aristas ortogonales en sus pasillos. Devuelve aristas nuevas (no muta).
 * Los bucles y las polilíneas se devuelven tal cual.
 */
export function nudgeEdges(
  edges: readonly EdgePath[],
  nodes: readonly NodeBox[],
  packages: readonly PackageBox[],
  notes: readonly NoteBox[] = [],
): EdgePath[] {
  const ctx: Ctx = {
    boxes: [...nodes, ...notes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))],
    packages,
    nodeById: new Map(nodes.map((n) => [n.id, n] as const)),
  };
  const pts: (number[] | null)[] = edges.map((e) =>
    e.routing === 'orthogonal' && !e.self && e.source !== e.target && e.points.length >= 4 ? e.points.slice() : null,
  );

  // Dos rondas: mover los horizontales cambia la longitud de los verticales (y viceversa).
  for (let round = 0; round < 2; round++) {
    for (const horizPass of [true, false]) {
      const segs = buildSegments(edges, pts, horizPass, ctx);
      for (const group of groupSegments(segs)) {
        const sorted = [...group].sort((s, t) => s.c - t.c || s.e - t.e || s.i - t.i);
        const targets = targetPositions(sorted);
        sorted.forEach((s, j) => {
          const p = pts[s.e];
          const e = edges[s.e];
          const v = targets[j];
          if (!p || !e || v === undefined) return;
          tryMove(e, p, s.i, s.horiz, Math.round(v * 2) / 2, ctx);
        });
      }
    }
  }

  return edges.map((e, k) => {
    const p = pts[k];
    return p ? { ...e, points: p } : e;
  });
}

const BUCKET_TOLERANCE = 6;
const LANE_SPACING = 8;

interface SegmentEntry {
  edgeIdx: number;
  segIdx: number;
  isHorizontal: boolean;
  min: number;
  max: number;
}

export function nudgeRoutedEdges(
  edges: DiagramEdgeLayout[],
  nodes: Map<string, DiagramNodeLayout>
): DiagramEdgeLayout[] {
  const cloned = edges.map((e) => ({
    ...e,
    points: (e.manualPoints ?? e.points).map((p) => ({ x: p.x, y: p.y })),
  }));

  // 1. Forzar ortogonalidad estricta en cualquier tramo oblicuo
  for (const edge of cloned) {
    edge.points = enforceOrthogonal(edge.points);
  }

  // 2. Indexar segmentos interiores en buckets lineales
  const hBuckets = new Map<number, SegmentEntry[]>();
  const vBuckets = new Map<number, SegmentEntry[]>();

  for (let eIdx = 0; eIdx < cloned.length; eIdx++) {
    if (cloned[eIdx].manualPoints) continue; // No alterar tramos fijados manualmente
    const pts = cloned[eIdx].points;
    if (pts.length < 4) continue;

    for (let sIdx = 1; sIdx < pts.length - 2; sIdx++) {
      const a = pts[sIdx];
      const b = pts[sIdx + 1];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);

      if (dy < 1 && dx > 10) {
        const key = Math.round(a.y / BUCKET_TOLERANCE);
        const bucket = hBuckets.get(key) ?? [];
        bucket.push({
          edgeIdx: eIdx,
          segIdx: sIdx,
          isHorizontal: true,
          min: Math.min(a.x, b.x),
          max: Math.max(a.x, b.x),
        });
        hBuckets.set(key, bucket);
      } else if (dx < 1 && dy > 10) {
        const key = Math.round(a.x / BUCKET_TOLERANCE);
        const bucket = vBuckets.get(key) ?? [];
        bucket.push({
          edgeIdx: eIdx,
          segIdx: sIdx,
          isHorizontal: false,
          min: Math.min(a.y, b.y),
          max: Math.max(a.y, b.y),
        });
        vBuckets.set(key, bucket);
      }
    }
  }

  // 3. Asignación de carriles mediante barrido de intervalos O(K log K)
  const applyBucketNudge = (buckets: Map<number, SegmentEntry[]>) => {
    for (const entries of buckets.values()) {
      if (entries.length <= 1) continue;
      entries.sort((a, b) => a.min - b.min || a.max - b.max);

      const laneEnds: number[] = [];
      const assignedLane: number[] = new Array(entries.length).fill(0);

      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        let lane = -1;
        for (let l = 0; l < laneEnds.length; l++) {
          if (laneEnds[l] + 4 < item.min) {
            lane = l;
            laneEnds[l] = item.max;
            break;
          }
        }
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(item.max);
        }
        assignedLane[i] = lane;
      }

      if (laneEnds.length <= 1) continue;

      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        const offset = (assignedLane[i] - (laneEnds.length - 1) / 2) * LANE_SPACING;
        const pts = cloned[item.edgeIdx].points;
        if (item.isHorizontal) {
          pts[item.segIdx].y += offset;
          pts[item.segIdx + 1].y += offset;
        } else {
          pts[item.segIdx].x += offset;
          pts[item.segIdx + 1].x += offset;
        }
      }
    }
  };

  applyBucketNudge(hBuckets);
  applyBucketNudge(vBuckets);

  // 4. Distribuir puertos en los bordes de cada tarjeta para evitar colisiones al llegar
  distributePortsOnNodes(cloned, nodes);

  return cloned;
}

export function enforceOrthogonal(pts: Point2D[]): Point2D[] {
  if (pts.length < 2) return pts;
  const out: Point2D[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const curr = pts[i];
    if (Math.abs(curr.x - prev.x) > 1.5 && Math.abs(curr.y - prev.y) > 1.5) {
      const midY = (prev.y + curr.y) / 2;
      out.push({ x: prev.x, y: midY }, { x: curr.x, y: midY });
    }
    out.push(curr);
  }
  return out;
}

function distributePortsOnNodes(
  edges: DiagramEdgeLayout[],
  nodes: Map<string, DiagramNodeLayout>
) {
  type Side = 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
  interface PortSlot {
    edge: DiagramEdgeLayout;
    isSource: boolean;
    side: Side;
    refCoord: number;
  }

  const slotsByNodeSide = new Map<string, PortSlot[]>();

  for (const edge of edges) {
    if (edge.points.length < 2) continue;
    for (const isSource of [true, false]) {
      const nodeId = isSource ? edge.source : edge.target;
      const node = nodes.get(nodeId);
      if (!node) continue;

      const endpoint = isSource ? edge.points[0] : edge.points[edge.points.length - 1];
      const neighbor = isSource ? edge.points[1] : edge.points[edge.points.length - 2];

      const dTop = Math.abs(endpoint.y - node.y);
      const dBottom = Math.abs(endpoint.y - (node.y + node.height));
      const dLeft = Math.abs(endpoint.x - node.x);
      const dRight = Math.abs(endpoint.x - (node.x + node.width));
      const minD = Math.min(dTop, dBottom, dLeft, dRight);

      const side: Side =
        minD === dTop ? 'TOP' : minD === dBottom ? 'BOTTOM' : minD === dLeft ? 'LEFT' : 'RIGHT';

      const key = `${nodeId}:${side}`;
      const list = slotsByNodeSide.get(key) ?? [];
      list.push({
        edge,
        isSource,
        side,
        refCoord: side === 'TOP' || side === 'BOTTOM' ? neighbor.x : neighbor.y,
      });
      slotsByNodeSide.set(key, list);
    }
  }

  for (const [key, list] of slotsByNodeSide.entries()) {
    if (list.length <= 1) continue;
    const [nodeId, side] = key.split(':') as [string, Side];
    const node = nodes.get(nodeId)!;
    list.sort((a, b) => a.refCoord - b.refCoord);

    const pad = 14;
    const span =
      side === 'TOP' || side === 'BOTTOM'
        ? Math.max(16, node.width - pad * 2)
        : Math.max(16, node.height - pad * 2);

    for (let i = 0; i < list.length; i++) {
      const slot = list[i];
      const pts = slot.edge.points;
      const ratio = (i + 1) / (list.length + 1);

      if (side === 'TOP' || side === 'BOTTOM') {
        const x = node.x + pad + span * ratio;
        if (slot.isSource) {
          pts[0].x = x;
          if (pts.length >= 3 && Math.abs(pts[1].y - pts[2].y) < 1) pts[1].x = x;
        } else {
          pts[pts.length - 1].x = x;
          if (pts.length >= 3 && Math.abs(pts[pts.length - 2].y - pts[pts.length - 3].y) < 1) {
            pts[pts.length - 2].x = x;
          }
        }
      } else {
        const y = node.y + pad + span * ratio;
        if (slot.isSource) {
          pts[0].y = y;
          if (pts.length >= 3 && Math.abs(pts[1].x - pts[2].x) < 1) pts[1].y = y;
        } else {
          pts[pts.length - 1].y = y;
          if (pts.length >= 3 && Math.abs(pts[pts.length - 2].x - pts[pts.length - 3].x) < 1) {
            pts[pts.length - 2].y = y;
          }
        }
      }
    }
  }
}
