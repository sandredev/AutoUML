// src/render/layout/elkLayout.ts — layout con ELK (layered + ortogonal) y respaldo dagre.
// Usa elk.bundled.js directamente (sin worker anidado): fiable en Electron file:// + ASAR.
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { DiagramModel, RelType, TypeNode } from '../../core/model';
import type { EdgePath, LayoutOptions, LayoutResult, NodeBox, PackageBox } from '../types';
import { computeLayout } from './layout';
import { cardContentOf, makeMeasurer, measureCardBox } from './cardModel';
import { DEFAULT_DETAIL } from '../style/contract';
import ELK from 'elkjs/lib/elk.bundled.js';
import { withElkEnv } from './elkEnv';

const DEFAULT_RANK_SEP = 80;
const DEFAULT_NODE_SEP = 40;
const PKG_PREFIX = 'pkg::';
// Margen interior de los paquetes: arriba deja sitio al nombre del paquete.
const PKG_PADDING = '[top=30,left=16,bottom=16,right=16]';

/** Opciones de ELK por tipo de relación. */
function edgeOptions(hierarchy: boolean): Record<string, string> {
  return hierarchy
    ? {
        // Herencia/implementación: mandan en el orden vertical (padre arriba).
        'elk.layered.priority.direction': '10',
        'elk.layered.priority.shortness': '5',
        'elk.layered.priority.straightness': '5',
      }
    : {
        // Asociación/dependencia: no fijan capas, pero se intenta que sean cortas.
        'elk.layered.priority.direction': '0',
        'elk.layered.priority.shortness': '1',
        'elk.layered.priority.straightness': '1',
      };
}

// Se crea perezosamente y dentro de withElkEnv: ver elkEnv.ts (si no, en el Worker siempre falla).
let elkEngine: InstanceType<typeof ELK> | null = null;
function getElk(): InstanceType<typeof ELK> {
  elkEngine ??= withElkEnv(() => new ELK());
  return elkEngine;
}

function isHierarchy(t: RelType): boolean {
  return t === 'EXTENDS' || t === 'IMPLEMENTS';
}

export async function computeElkLayout(model: DiagramModel, opts?: LayoutOptions): Promise<LayoutResult> {
  if (model.types.length === 0) {
    return { nodes: [], edges: [], packages: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  }
  const summary = opts?.summary ?? model.summaryMode;
  const rankSep = opts?.rankSep ?? DEFAULT_RANK_SEP;
  const nodeSep = opts?.nodeSep ?? DEFAULT_NODE_SEP;
  const detail = opts?.detail ?? DEFAULT_DETAIL;

  const typeIds = new Set(model.types.map((t) => t.id));
  const pkgOf = new Map<string, string>();
  for (const p of model.packages) for (const id of p.typeIds) if (typeIds.has(id)) pkgOf.set(id, p.name);
  const hasPackages = pkgOf.size > 0;

  const measure = makeMeasurer();
  const measureNode = (t: TypeNode): { w: number; h: number } =>
    measureCardBox(cardContentOf(t, detail, summary), measure);

  const leaf = new Map<string, ElkNode>();
  for (const t of model.types) {
    const m = measureNode(t);
    leaf.set(t.id, { id: t.id, width: m.w, height: m.h });
  }

  const rootChildren: ElkNode[] = [];
  for (const p of model.packages) {
    const kids = p.typeIds.filter((id) => pkgOf.get(id) === p.name).map((id) => leaf.get(id)).filter((n): n is ElkNode => !!n);
    if (kids.length === 0) continue;
    rootChildren.push({
      id: PKG_PREFIX + p.name,
      children: kids,
      layoutOptions: { 'elk.padding': PKG_PADDING },
    });
  }
  for (const t of model.types) if (!pkgOf.has(t.id)) { const n = leaf.get(t.id); if (n) rootChildren.push(n); }

  // Herencia: se invierte (padre → hijo) para que el padre quede arriba en TB.
  const edges: ElkExtendedEdge[] = [];
  const meta = new Map<string, { reversed: boolean; rel: DiagramModel['relationships'][number] }>();
  model.relationships.forEach((r, i) => {
    if (!typeIds.has(r.source) || !typeIds.has(r.target) || r.source === r.target) return;
    const reversed = isHierarchy(r.type);
    edges.push({
      id: 'e' + i,
      sources: [reversed ? r.target : r.source],
      targets: [reversed ? r.source : r.target],
      layoutOptions: edgeOptions(reversed),
    });
    meta.set('e' + i, { reversed, rel: r });
  });

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      // Coordenadas de aristas absolutas: con INCLUDE_CHILDREN, ELK mueve las aristas internas a su paquete
      // y por defecto devolvería sus puntos relativos a ese contenedor (aristas desplazadas).
      'elk.json.edgeCoords': 'ROOT',
      // Separaciones derivadas de las opciones de vista.
      'elk.spacing.nodeNode': String(nodeSep),
      'elk.spacing.edgeNode': String(Math.max(12, Math.round(nodeSep / 2))),
      'elk.spacing.edgeEdge': '8',
      'elk.spacing.componentComponent': String(nodeSep * 2),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(rankSep),
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
      // Menos cruces y aristas más cortas.
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.thoroughness': '10',
      // Quita el espacio vacío que deja el ruteo entre capas.
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
  // Se empareja por id (no por índice): ELK puede reordenar o reubicar aristas en la salida.
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
    const points = m.reversed ? reversePoints(pts) : pts;
    const ep: EdgePath = { source: m.rel.source, target: m.rel.target, type: m.rel.type, points, routing: 'orthogonal' };
    if (m.rel.label !== undefined) ep.label = m.rel.label;
    outEdges.push(ep);
  });

  return { nodes, edges: outEdges, packages, bounds: computeBounds(nodes, packages, outEdges) };
}

function reversePoints(p: number[]): number[] {
  const r: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i] as number, p[i + 1] as number);
  return r;
}

// Incluye los puntos de las aristas: ELK puede rodear paquetes por fuera de las cajas,
// y si no se cuentan, fit()/minimapa recortan esas aristas.
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

// ---------- Orquestación ELK → dagre (pura, testeable sin DOM) ----------
export type LayoutEngine = 'elk' | 'dagre';
export interface EngineResult {
  result: LayoutResult;
  engine: LayoutEngine;
  fallback?: string;
  ms: number;
}
export interface EngineDeps {
  elk: (m: DiagramModel, o?: LayoutOptions) => Promise<LayoutResult>;
  dagre: (m: DiagramModel, o?: LayoutOptions) => LayoutResult;
  timeoutMs: number;
}
const DEFAULT_DEPS: EngineDeps = { elk: computeElkLayout, dagre: computeLayout, timeoutMs: 20000 };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ELK superó ${ms} ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

export async function runLayoutWithFallback(
  model: DiagramModel,
  opts?: LayoutOptions,
  deps: Partial<EngineDeps> = {},
): Promise<EngineResult> {
  const d: EngineDeps = { ...DEFAULT_DEPS, ...deps };
  const t0 = performance.now();
  try {
    const result = await withTimeout(d.elk(model, opts), d.timeoutMs);
    return { result, engine: 'elk', ms: Math.round(performance.now() - t0) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const result = d.dagre(model, opts);
    return { result, engine: 'dagre', fallback: 'ELK falló, usando dagre: ' + (reason || 'error desconocido'), ms: Math.round(performance.now() - t0) };
  }
}
