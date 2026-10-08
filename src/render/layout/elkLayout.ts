// src/render/layout/elkLayout.ts — layout con ELK (layered + ortogonal) y respaldo dagre.
// Usa elk.bundled.js directamente (sin worker anidado): fiable en Electron file:// + ASAR.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { DiagramModel, RelType } from '../../core/model';
import type { EdgePath, LayoutOptions, LayoutResult, NodeBox, PackageBox } from '../types';
import { computeLayout, measureNode } from './layout';

const DEFAULT_RANK_SEP = 80;
const DEFAULT_NODE_SEP = 40;
const PKG_PREFIX = 'pkg::';

const elk = new ELK();

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

  const typeIds = new Set(model.types.map((t) => t.id));
  const pkgOf = new Map<string, string>();
  for (const p of model.packages) for (const id of p.typeIds) if (typeIds.has(id)) pkgOf.set(id, p.name);
  const hasPackages = pkgOf.size > 0;

  const leaf = new Map<string, ElkNode>();
  for (const t of model.types) {
    const m = measureNode(t, summary);
    leaf.set(t.id, { id: t.id, width: m.w, height: m.h });
  }

  const rootChildren: ElkNode[] = [];
  for (const p of model.packages) {
    const kids = p.typeIds.filter((id) => pkgOf.get(id) === p.name).map((id) => leaf.get(id)).filter((n): n is ElkNode => !!n);
    if (kids.length === 0) continue;
    rootChildren.push({
      id: PKG_PREFIX + p.name,
      children: kids,
      layoutOptions: { 'elk.padding': '[top=28,left=12,bottom=12,right=12]' },
    });
  }
  for (const t of model.types) if (!pkgOf.has(t.id)) { const n = leaf.get(t.id); if (n) rootChildren.push(n); }

  // Herencia: se invierte (padre → hijo) para que el padre quede arriba en TB.
  const edges: ElkExtendedEdge[] = [];
  const meta: { reversed: boolean; rel: DiagramModel['relationships'][number] }[] = [];
  model.relationships.forEach((r, i) => {
    if (!typeIds.has(r.source) || !typeIds.has(r.target) || r.source === r.target) return;
    const reversed = isHierarchy(r.type);
    edges.push({
      id: 'e' + i,
      sources: [reversed ? r.target : r.source],
      targets: [reversed ? r.source : r.target],
      layoutOptions: reversed ? { 'elk.layered.priority.direction': '10' } : { 'elk.layered.priority.direction': '0' },
    });
    meta.push({ reversed, rel: r });
  });

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(nodeSep),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(rankSep),
      ...(hasPackages ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
    },
    children: rootChildren,
    edges,
  };

  const out = await elk.layout(graph);

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
  (out.edges ?? []).forEach((e, i) => {
    const m = meta[i];
    if (!m) return;
    const pts: number[] = [];
    for (const s of e.sections ?? []) {
      pts.push(s.startPoint.x, s.startPoint.y);
      for (const b of s.bendPoints ?? []) pts.push(b.x, b.y);
      pts.push(s.endPoint.x, s.endPoint.y);
    }
    if (pts.length < 4) return;
    const points = m.reversed ? reversePoints(pts) : pts;
    const ep: EdgePath = { source: m.rel.source, target: m.rel.target, type: m.rel.type, points };
    if (m.rel.label !== undefined) ep.label = m.rel.label;
    outEdges.push(ep);
  });

  return { nodes, edges: outEdges, packages, bounds: computeBounds(nodes, packages) };
}

function reversePoints(p: number[]): number[] {
  const r: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i] as number, p[i + 1] as number);
  return r;
}

function computeBounds(nodes: NodeBox[], packages: PackageBox[]): LayoutResult['bounds'] {
  const boxes = [...nodes, ...packages];
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
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
