// src/presentation/diagram/layout/elkLayout.ts — layout con ELK (placement layered + router ortogonal propio). Puro: sin timeout aquí.
// El límite de tiempo vive en el hilo principal (useLayout): ELK es síncrono y bloquea el Worker,
// así que un setTimeout dentro del Worker no puede saltar a tiempo.
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { DiagramModel, RelationshipModel, RelType } from '../../../domain/diagram/model';
import {
  computeDiagramBounds,
  openPackageChannels,
  packageBoxesFromModel,
  PKG_PADDING,
  routeAllEdges,
} from '../routing';
import type {
  DiagramLayoutModel,
  DiagramNodeLayout,
  DiagramPackageLayout,
  DiagramEdgeLayout,
  RelationKind,
  EdgePath,
  LayoutOptions,
  LayoutResult,
  NodeBox,
  PackageBox,
} from '../types';
import { computeLayout, measureNode } from './layout';
import ELK from 'elkjs/lib/elk.bundled.js';
import { withElkEnv } from './elkEnv';
import { selfLoopPoints } from './selfLoop';
import { anchorToHints, boundsOf, completeHints, hintsUsable, PKG_HINT_PREFIX as PKG_PREFIX, type Point } from './stability';

const DEFAULT_RANK_SEP = 80;
const DEFAULT_NODE_SEP = 40;
/**
 * Separación que ELK aplica DENTRO de un paquete: su valor por defecto (20), no rankSep/nodeSep (medido).
 * El modo estable plano con paquetes usa la misma para que pasar del layout jerárquico al plano no estire
 * el diagrama. Si algún día se aplican rankSep/nodeSep dentro de los paquetes, cambiar también esto.
 */
const PACKAGED_GAP = 20;
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
 * - hint perpendicular (left/right en TB, up/down en LR): NO se aplica.
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

/**
 * Modo estable (T6): ELK respeta las posiciones previas en vez de recalcular desde cero.
 * Requisito: que el layout anterior (la pista) no esté compactado; por eso postCompaction es NONE siempre.
 */
const STABLE_OPTIONS: Record<string, string> = {
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
  'elk.separateConnectedComponents': 'false',
  'elk.layered.compaction.connectedComponents': 'false',
};

function placeAt(n: ElkNode, p: Point): void {
  n.x = p.x;
  n.y = p.y;
  n.layoutOptions = { ...n.layoutOptions, 'elk.position': `(${p.x},${p.y})` };
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

  const ids = model.types.map((t) => t.id);
  const stable = hintsUsable(ids, opts?.hints);
  const flat = stable && hasPackages;

  const rootChildren: ElkNode[] = [];
  for (const p of flat ? [] : model.packages) {
    const kids = p.typeIds.filter((id) => pkgOf.get(id) === p.name).map((id) => leaf.get(id)).filter((n): n is ElkNode => !!n);
    if (kids.length === 0) continue;
    rootChildren.push({ id: PKG_PREFIX + p.name, children: kids, layoutOptions: { 'elk.padding': PKG_PADDING } });
  }
  for (const t of model.types) if (flat || !pkgOf.has(t.id)) { const n = leaf.get(t.id); if (n) rootChildren.push(n); }

  const edges: ElkExtendedEdge[] = [];
  const meta = new Map<string, { reversed: boolean; rel: RelationshipModel; idx: number }>();
  const selfRels: number[] = [];
  const layerEdges: { from: string; to: string }[] = [];
  model.relationships.forEach((r, i) => {
    if (!typeIds.has(r.source) || !typeIds.has(r.target)) return;
    if (r.source === r.target) { selfRels.push(i); return; }
    const { reversed, strong } = layeringOf(r, dir);
    edges.push({
      id: 'e' + i,
      sources: [reversed ? r.target : r.source],
      targets: [reversed ? r.source : r.target],
      layoutOptions: edgeOptions(strong),
    });
    meta.set('e' + i, { reversed, rel: r, idx: i });
    layerEdges.push(reversed ? { from: r.target, to: r.source } : { from: r.source, to: r.target });
  });

  if (stable && opts?.hints) {
    const seeded = completeHints({
      ids, hints: opts.hints, edges: layerEdges, dir, rankSep, nodeSep,
      size: (id) => {
        const n = leaf.get(id);
        return { w: n?.width ?? 0, h: n?.height ?? 0 };
      },
      groupOf: (id) => pkgOf.get(id),
    });
    for (const n of rootChildren) placeAt(n, seeded[n.id] ?? { x: 0, y: 0 });
  }

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
      'elk.layered.compaction.postCompaction.strategy': 'NONE',
      'elk.layered.compaction.connectedComponents': 'true',
      'elk.separateConnectedComponents': 'true',
      'elk.layered.unnecessaryBendpoints': 'false',
      ...(hasPackages && !flat ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
      ...(stable ? STABLE_OPTIONS : {}),
      ...(flat ? { 'elk.spacing.nodeNode': String(PACKAGED_GAP), 'elk.layered.spacing.nodeNodeBetweenLayers': String(PACKAGED_GAP) } : {}),
    },
    children: rootChildren,
    edges,
  };

  let out: ElkNode;
  try {
    out = await getElk().layout(graph);
  } catch (err) {
    if (!stable) throw err;
    return computeElkLayout(model, { ...opts, hints: undefined });
  }

  const rawNodes: NodeBox[] = [];
  const layerOf = new Map(model.packages.map((p) => [p.name, p.layer] as const));
  const typeById = new Map(model.types.map((t) => [t.id, t] as const));

  const walk = (n: ElkNode, ox: number, oy: number): void => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      const w = c.width ?? 0;
      const h = c.height ?? 0;
      if (c.id.startsWith(PKG_PREFIX)) {
        walk(c, x, y);
      } else {
        const t = typeById.get(c.id);
        const nb: NodeBox = { id: c.id, x, y, w, h };
        if (t) nb.label = t.name;
        const pk = pkgOf.get(c.id);
        if (pk !== undefined) nb.packageName = pk;
        rawNodes.push(nb);
      }
    }
  };
  walk(out, 0, 0);

  // Construir descriptores de aristas (para polyline conserva puntos de ELK; para orthogonal el router propio las calcula)
  const pendingEdges: EdgePath[] = [];
  (out.edges ?? []).forEach((e) => {
    const m = meta.get(e.id);
    if (!m) return;
    const pts: number[] = [];
    for (const s of e.sections ?? []) {
      pts.push(s.startPoint.x, s.startPoint.y);
      for (const b of s.bendPoints ?? []) pts.push(b.x, b.y);
      pts.push(s.endPoint.x, s.endPoint.y);
    }
    if (pts.length < 4 && routing === 'polyline') return;
    const ep: EdgePath = {
      source: m.rel.source,
      target: m.rel.target,
      type: m.rel.type,
      points: m.reversed ? reversePoints(pts) : pts,
      routing,
      rel: m.idx,
    };
    if (m.rel.label !== undefined) ep.label = m.rel.label;
    pendingEdges.push(ep);
  });

  const boxById = new Map(rawNodes.map((n) => [n.id, n] as const));
  const loops = new Map<string, number>();
  for (const i of selfRels) {
    const r = model.relationships[i];
    const b = r ? boxById.get(r.source) : undefined;
    if (!r || !b) continue;
    const k = loops.get(b.id) ?? 0;
    loops.set(b.id, k + 1);
    const ep: EdgePath = {
      source: r.source,
      target: r.target,
      type: r.type,
      points: selfLoopPoints(b, k),
      routing: 'orthogonal',
      rel: i,
      self: true,
    };
    if (r.label !== undefined) ep.label = r.label;
    pendingEdges.push(ep);
  }

  // Paquete = envelope(nodes) + PKG_PAD estricto (nunca inflado por las aristas internas de ELK)
  let packages: PackageBox[] = packageBoxesFromModel(model, rawNodes, layerOf);
  let nodes: NodeBox[] = rawNodes;

  // ELK ya separa los paquetes; el router A* rodea los canales estrechos por sí solo. Solo se
  // repara (desplazamiento rígido) cuando dos cajas se solapan de verdad: ensanchar canales por
  // estética aquí lucharía contra el colocador y rompería la estabilidad T6 entre recálculos.
  if (!stable && packages.length > 1 && anyPackageOverlap(packages)) {
    const pushed = openPackageChannels(nodes, packages, pendingEdges);
    nodes = pushed.nodes;
    packages = pushed.packages;
  }

  if (!stable) {
    const routedEdges =
      routing === 'orthogonal' ? routeAllEdges(nodes, packages, pendingEdges) : pendingEdges;
    return {
      nodes,
      edges: routedEdges,
      packages,
      bounds: computeDiagramBounds(nodes, packages, routedEdges),
    };
  }

  // Modo estable (T6): anclar posiciones primero, derivar cajas de paquete después y rutear sobre la geometría final
  const preAnchored: LayoutResult = {
    nodes,
    edges: pendingEdges,
    packages,
    bounds: computeDiagramBounds(nodes, packages, pendingEdges),
  };
  const anchored = anchorToHints(preAnchored, opts?.hints, dir);
  const finalPackages = flat ? packageBoxesFromModel(model, anchored.nodes, layerOf) : anchored.packages;
  const finalEdges =
    routing === 'orthogonal'
      ? routeAllEdges(anchored.nodes, finalPackages, anchored.edges, anchored.notes ?? [])
      : anchored.edges;
  return {
    ...anchored,
    packages: finalPackages,
    edges: finalEdges,
    bounds: boundsOf(anchored.nodes, finalPackages, finalEdges),
  };
}

function reversePoints(p: number[]): number[] {
  const r: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i] ?? 0, p[i + 1] ?? 0);
  return r;
}

/** ¿Se solapa de verdad algún par de cajas de paquete? (Rozar el borde no cuenta.) */
function anyPackageOverlap(packages: readonly PackageBox[]): boolean {
  for (let i = 0; i < packages.length; i++) {
    for (let j = i + 1; j < packages.length; j++) {
      const a = packages[i];
      const b = packages[j];
      if (!a || !b) continue;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  }
  return false;
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

export interface ElkInputNode {
  id: string;
  name: string;
  packagePath?: string;
  width: number;
  height: number;
}

export interface ElkInputEdge {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  label?: string;
}

export async function runHierarchicalElkLayout(
  inputNodes: ElkInputNode[],
  inputEdges: ElkInputEdge[]
): Promise<DiagramLayoutModel> {
  const isLargeGraph = inputNodes.length >= 200;

  const rootOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.nodeNode': isLargeGraph ? '44' : '34',
    'elk.layered.spacing.nodeNodeBetweenLayers': isLargeGraph ? '64' : '50',
    'elk.spacing.edgeNode': '20',
    'elk.spacing.edgeEdge': '12',
    'elk.spacing.componentComponent': '64',
    'elk.layered.thoroughness': isLargeGraph ? '3' : '7',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.cycleBreaking.strategy': 'GREEDY',
  };

  const root: ElkNode = {
    id: 'root',
    layoutOptions: rootOptions,
    children: [],
    edges: [],
  };

  const pkgNodeMap = new Map<string, ElkNode>();
  const pkgMetaMap = new Map<
    string,
    { name: string; fullPath: string; parentPath?: string; depth: number }
  >();

  function ensurePackageHierarchy(packagePath: string): ElkNode {
    const parts = packagePath.split('.').filter(Boolean);
    let currentPath = '';
    let parentPath: string | undefined = undefined;
    let currentContainer = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}.${part}` : part;
      const pkgId = `pkg:${currentPath}`;

      let elkPkg = pkgNodeMap.get(pkgId);
      if (!elkPkg) {
        elkPkg = {
          id: pkgId,
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'DOWN',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.padding': '[top=42,left=24,bottom=24,right=24]',
            'elk.spacing.nodeNode': '32',
            'elk.layered.spacing.nodeNodeBetweenLayers': '48',
          },
          children: [],
        };
        pkgNodeMap.set(pkgId, elkPkg);
        pkgMetaMap.set(pkgId, {
          name: part,
          fullPath: currentPath,
          parentPath,
          depth: i,
        });
        currentContainer.children!.push(elkPkg);
      }
      parentPath = currentPath;
      currentContainer = elkPkg;
    }

    return currentContainer;
  }

  const validIds = new Set<string>();
  const inputNodeById = new Map<string, ElkInputNode>();

  for (const item of inputNodes) {
    validIds.add(item.id);
    inputNodeById.set(item.id, item);

    const elkLeaf: ElkNode = {
      id: item.id,
      width: Math.max(120, item.width),
      height: Math.max(56, item.height),
      layoutOptions: { 'elk.portConstraints': 'FREE' },
    };

    if (item.packagePath && item.packagePath.trim().length > 0) {
      const container = ensurePackageHierarchy(item.packagePath.trim());
      container.children!.push(elkLeaf);
    } else {
      root.children!.push(elkLeaf);
    }
  }

  const elkEdges: ElkExtendedEdge[] = [];
  for (const edge of inputEdges) {
    if (!validIds.has(edge.source) || !validIds.has(edge.target)) continue;
    elkEdges.push({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    });
  }
  root.edges = elkEdges;

  const laidOut = await getElk().layout(root);

  const nodes = new Map<string, DiagramNodeLayout>();
  const packages: DiagramPackageLayout[] = [];
  const containerAbsOffsets = new Map<string, { x: number; y: number }>();

  function flattenGraph(node: ElkNode, offsetX: number, offsetY: number) {
    const absX = offsetX + (node.x ?? 0);
    const absY = offsetY + (node.y ?? 0);
    containerAbsOffsets.set(node.id, { x: absX, y: absY });

    if (node.id !== 'root') {
      if (node.id.startsWith('pkg:')) {
        const meta = pkgMetaMap.get(node.id)!;
        packages.push({
          id: node.id,
          name: meta.name,
          fullPath: meta.fullPath,
          parentPath: meta.parentPath,
          depth: meta.depth,
          x: absX,
          y: absY,
          width: node.width ?? 0,
          height: node.height ?? 0,
        });
      } else {
        const orig = inputNodeById.get(node.id)!;
        nodes.set(node.id, {
          id: node.id,
          name: orig.name,
          packagePath: orig.packagePath,
          x: absX,
          y: absY,
          width: node.width ?? orig.width,
          height: node.height ?? orig.height,
        });
      }
    }

    for (const child of node.children ?? []) {
      flattenGraph(child, absX, absY);
    }
  }

  flattenGraph(laidOut, 0, 0);
  packages.sort((a, b) => a.depth - b.depth);

  const edgeMeta = new Map(inputEdges.map((e) => [e.id, e]));
  const edges: DiagramEdgeLayout[] = [];

  for (const elkEdge of laidOut.edges ?? []) {
    const meta = edgeMeta.get(elkEdge.id);
    if (!meta) continue;
    const containerId = (elkEdge as { container?: string }).container ?? 'root';
    const offset = containerAbsOffsets.get(containerId) ?? { x: 0, y: 0 };
    const points: Array<{ x: number; y: number }> = [];

    const sec = elkEdge.sections?.[0];
    if (sec) {
      points.push({ x: offset.x + sec.startPoint.x, y: offset.y + sec.startPoint.y });
      for (const bp of sec.bendPoints ?? []) {
        points.push({ x: offset.x + bp.x, y: offset.y + bp.y });
      }
      points.push({ x: offset.x + sec.endPoint.x, y: offset.y + sec.endPoint.y });
    }

    edges.push({
      id: elkEdge.id,
      source: meta.source,
      target: meta.target,
      kind: meta.kind,
      label: meta.label,
      points,
    });
  }

  return {
    nodes,
    packages,
    edges,
    width: laidOut.width ?? 1200,
    height: laidOut.height ?? 900,
  };
}
