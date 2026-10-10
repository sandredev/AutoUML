// src/render/layout/elkLayout.ts — layout con ELK (layered + ortogonal). Puro: sin timeout aquí.
// El límite de tiempo vive en el hilo principal (useLayout): ELK es síncrono y bloquea el Worker,
// así que un setTimeout dentro del Worker no puede saltar a tiempo.
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { DiagramModel, RelationshipModel, RelType } from '../../core/model';
import type { EdgePath, LayoutOptions, LayoutResult, NodeBox, PackageBox } from '../types';
import { computeLayout, measureNode } from './layout';
import ELK from 'elkjs/lib/elk.bundled.js';
import { withElkEnv } from './elkEnv';
import { selfLoopPoints } from './selfLoop';

const DEFAULT_RANK_SEP = 80;
const DEFAULT_NODE_SEP = 40;
const PKG_PREFIX = 'pkg::';
const PKG_PADDING = '[top=30,left=16,bottom=16,right=16]';
/** Por encima de este número de nodos se baja la calidad de ELK para que termine a tiempo. */
export const ELK_FAST_NODES = 300;

let elkEngine: InstanceType<typeof ELK> | null = null;
function getElk(): InstanceType<typeof ELK> {
  elkEngine ??= withElkEnv(() => new ELK());
  return elkEngine;
}

function isHierarchy(t: RelType): boolean {
  return t === 'EXTENDS' || t === 'IMPLEMENTS';
}

/**
 * Sentido de la arista para el layering y si manda en el orden de capas.
 * - Herencia: padre antes que hijo (arriba en TB, izquierda en LR).
 * - hint en el eje del layout (down/up en TB, right/left en LR): se respeta invirtiendo la arista si
 *   hace falta y con prioridad alta (restricción suave: ELK puede romperla con ciclos).
 * - hint perpendicular (left/right en TB, up/down en LR): NO se aplica. ELK layered no tiene una
 *   restricción fiable de orden dentro de una capa sin posiciones interactivas (T6); se ignora sin error.
 */
export function layeringOf(r: RelationshipModel, dir: 'TB' | 'LR'): { reversed: boolean; strong: boolean } {
  const fwd = dir === 'LR' ? 'right' : 'down';
  const back = dir === 'LR' ? 'left' : 'up';
  if (r.hint === fwd) return { reversed: false, strong: true };
  if (r.hint === back) return { reversed: true, strong: true };
  const h = isHierarchy(r.type);
  return { reversed: h, strong: h };
}

function edgeOptions(strong: boolean): Record<string, string> {
  return strong
    ? { 'elk.layered.priority.direction': '10', 'elk.layered.priority.shortness': '5', 'elk.layered.priority.straightness': '5' }
    : { 'elk.layered.priority.direction': '0', 'elk.layered.priority.shortness': '1', 'elk.layered.priority.straightness': '1' };
}

export async function computeElkLayout(model: DiagramModel, opts?: LayoutOptions): Promise<LayoutResult> {
  if (model.types.length === 0) {
    return { nodes: [], edges: [], packages: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  }
  const summary = opts?.summary ?? model.summaryMode;
  const rankSep = opts?.rankSep ?? DEFAULT_RANK_SEP;
  const nodeSep = opts?.nodeSep ?? DEFAULT_NODE_SEP;
  const dir = model.direction === 'LR' ? 'LR' : 'TB';
  const big = model.types.length > ELK_FAST_NODES;
  const routing: 'orthogonal' | 'polyline' = opts?.linetype === 'polyline' ? 'polyline' : 'orthogonal';

  const typeIds = new Set(model.types.map((t) => t.id));
  const pkgOf = new Map<string, string>();
  for (const p of model.packages) for (const id of p.typeIds) if (typeIds.has(id)) pkgOf.set(id, p.name);
  const hasPackages = pkgOf.size > 0;

  const leaf = new Map<string, ElkNode>();
  for (const t of model.types) {
    const m = measureNode(t, summary, opts);
    leaf.set(t.id, { id: t.id, width: m.w, height: m.h });
  }

  const rootChildren: ElkNode[] = [];
  for (const p of model.packages) {
    const kids = p.typeIds.filter((id) => pkgOf.get(id) === p.name).map((id) => leaf.get(id)).filter((n): n is ElkNode => !!n);
    if (kids.length === 0) continue;
    rootChildren.push({ id: PKG_PREFIX + p.name, children: kids, layoutOptions: { 'elk.padding': PKG_PADDING } });
  }
  for (const t of model.types) if (!pkgOf.has(t.id)) { const n = leaf.get(t.id); if (n) rootChildren.push(n); }

  const edges: ElkExtendedEdge[] = [];
  const meta = new Map<string, { reversed: boolean; rel: RelationshipModel; idx: number }>();
  const selfRels: number[] = [];
  model.relationships.forEach((r, i) => {
    if (!typeIds.has(r.source) || !typeIds.has(r.target)) return;
    if (r.source === r.target) { selfRels.push(i); return; } // se añaden como bucle después de ELK
    const { reversed, strong } = layeringOf(r, dir);
    edges.push({
      id: 'e' + i,
      sources: [reversed ? r.target : r.source],
      targets: [reversed ? r.source : r.target],
      layoutOptions: edgeOptions(strong),
    });
    meta.set('e' + i, { reversed, rel: r, idx: i });
  });

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': dir === 'LR' ? 'RIGHT' : 'DOWN',
      'elk.edgeRouting': routing === 'polyline' ? 'POLYLINE' : 'ORTHOGONAL',
      'elk.json.edgeCoords': 'ROOT',
      'elk.spacing.nodeNode': String(nodeSep),
      'elk.spacing.edgeNode': String(Math.max(12, Math.round(nodeSep / 2))),
      'elk.spacing.edgeEdge': '8',
      'elk.spacing.componentComponent': String(nodeSep * 2),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(rankSep),
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
      'elk.layered.layering.strategy': big ? 'LONGEST_PATH' : 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': big ? 'BRANDES_KOEPF' : 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.thoroughness': big ? '3' : '10',
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
      'elk.layered.compaction.connectedComponents': 'true',
      'elk.separateConnectedComponents': 'true',
      'elk.layered.unnecessaryBendpoints': 'false',
      ...(hasPackages ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
    },
    children: rootChildren,
    edges,
  };

  const out = await getElk().layout(graph);

  const nodes: NodeBox[] = [];
  const packages: PackageBox[] = [];
  const layerOf = new Map(model.packages.map((p) => [p.name, p.layer] as const));
  const typeById = new Map(model.types.map((t) => [t.id, t] as const));

  const walk = (n: ElkNode, ox: number, oy: number): void => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      const w = c.width ?? 0;
      const h = c.height ?? 0;
      if (c.id.startsWith(PKG_PREFIX)) {
        const name = c.id.slice(PKG_PREFIX.length);
        const box: PackageBox = { name, x, y, w, h };
        const layer = layerOf.get(name);
        if (layer !== undefined) box.layer = layer;
        packages.push(box);
        walk(c, x, y);
      } else {
        const t = typeById.get(c.id);
        const nb: NodeBox = { id: c.id, x, y, w, h };
        if (t) nb.label = t.name;
        const pk = pkgOf.get(c.id);
        if (pk !== undefined) nb.packageName = pk;
        nodes.push(nb);
      }
    }
  };
  walk(out, 0, 0);

  const outEdges: EdgePath[] = [];
  (out.edges ?? []).forEach((e) => {
    const m = meta.get(e.id);
    if (!m) return;
    const pts: number[] = [];
    for (const s of e.sections ?? []) {
      pts.push(s.startPoint.x, s.startPoint.y);
      for (const b of s.bendPoints ?? []) pts.push(b.x, b.y);
      pts.push(s.endPoint.x, s.endPoint.y);
    }
    if (pts.length < 4) return;
    const ep: EdgePath = {
      source: m.rel.source, target: m.rel.target, type: m.rel.type,
      points: m.reversed ? reversePoints(pts) : pts, routing, rel: m.idx,
    };
    if (m.rel.label !== undefined) ep.label = m.rel.label;
    outEdges.push(ep);
  });

  // Bucles de una clase consigo misma (ELK no los rutea): esquina superior derecha, separados.
  const boxById = new Map(nodes.map((n) => [n.id, n] as const));
  const loops = new Map<string, number>();
  for (const i of selfRels) {
    const r = model.relationships[i];
    const b = r ? boxById.get(r.source) : undefined;
    if (!r || !b) continue;
    const k = loops.get(b.id) ?? 0;
    loops.set(b.id, k + 1);
    const ep: EdgePath = {
      source: r.source, target: r.target, type: r.type, points: selfLoopPoints(b, k),
      routing: 'orthogonal', rel: i, self: true,
    };
    if (r.label !== undefined) ep.label = r.label;
    outEdges.push(ep);
  }

  return { nodes, edges: outEdges, packages, bounds: computeBounds(nodes, packages, outEdges) };
}

function reversePoints(p: number[]): number[] {
  const r: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i] as number, p[i + 1] as number);
  return r;
}

function computeBounds(nodes: NodeBox[], packages: PackageBox[], edges: EdgePath[]): LayoutResult['bounds'] {
  const boxes = [...nodes, ...packages];
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  for (const e of edges) {
    for (let i = 0; i + 1 < e.points.length; i += 2) {
      const x = e.points[i] as number;
      const y = e.points[i + 1] as number;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- Orquestación ELK → dagre ante ERRORES (el timeout está en useLayout) ----------
export type LayoutEngine = 'elk' | 'dagre';
export interface EngineResult { result: LayoutResult; engine: LayoutEngine; fallback?: string; ms: number }
export interface EngineDeps {
  elk: (m: DiagramModel, o?: LayoutOptions) => Promise<LayoutResult>;
  dagre: (m: DiagramModel, o?: LayoutOptions) => LayoutResult;
  /** @deprecated Sin efecto: el timeout real lo aplica useLayout con worker.terminate(). */
  timeoutMs?: number;
}
const DEFAULT_DEPS: EngineDeps = { elk: computeElkLayout, dagre: computeLayout };

export async function runLayoutWithFallback(
  model: DiagramModel,
  opts?: LayoutOptions,
  deps: Partial<EngineDeps> = {},
): Promise<EngineResult> {
  const d: EngineDeps = { ...DEFAULT_DEPS, ...deps };
  const t0 = performance.now();
  try {
    const result = await d.elk(model, opts);
    return { result, engine: 'elk', ms: Math.round(performance.now() - t0) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const result = d.dagre(model, opts);
    return { result, engine: 'dagre', fallback: 'ELK falló, usando dagre: ' + (reason || 'error desconocido'), ms: Math.round(performance.now() - t0) };
  }
}
