// src/domain/analysis/analyze.ts — análisis de arquitectura completo de un modelo, memoizado (T9). Puro.
// Lo consume la capa de dibujo (overlay), el panel y el informe Markdown: los tres leen el MISMO resultado,
// así que lo que dice el informe coincide con lo que se ve.
import type { Category, DiagramModel } from '../diagram/model';
import { classCoupling, packageMetrics, topCoupled, type ClassCoupling, type CoupledClass, type PackageMetrics } from './coupling';
import { findCycles, packageGraph, type Cycle } from './cycles';
import { buildDependencyGraph, type AnalysisOptions, type Digraph } from './graph';
import { findLayerViolations, layerIndexOf, resolveLayers, type LayerSpec, type LayerViolation } from './layers';
import { categoryCounts, inheritanceDepth, type InheritanceDepth } from './metrics';

export interface AnalyzeOptions extends AnalysisOptions {
  /** Orden de capas de `layers.json` (de arriba abajo); sin él, el del modelo. */
  layers?: readonly string[] | null;
}

export interface DiagramAnalysis {
  graph: Digraph;
  cycles: Cycle[];
  /** Tipo → índice en `cycles` (solo los que están en un ciclo). */
  cycleOf: ReadonlyMap<string, number>;
  packageCycles: Cycle[];
  selfLoops: readonly string[];
  coupling: ReadonlyMap<string, ClassCoupling>;
  topCoupled: CoupledClass[];
  packages: PackageMetrics[];
  categories: Partial<Record<Category, number>>;
  inheritance: InheritanceDepth;
  layers: LayerSpec;
  layerOf: ReadonlyMap<string, number>;
  violations: LayerViolation[];
  /** true si a → b es una dependencia dentro de un ciclo. */
  isCycleEdge(a: string, b: string): boolean;
  /** true si a → b es una dependencia hacia una capa superior. */
  isViolationEdge(a: string, b: string): boolean;
}

/** Número de clases más acopladas que se listan. */
export const TOP_COUPLED = 5;

export function computeAnalysis(model: DiagramModel, opts: AnalyzeOptions = {}): DiagramAnalysis {
  const graph = buildDependencyGraph(model, opts);
  const cycles = findCycles(graph);
  const cycleOf = new Map<string, number>();
  cycles.forEach((c, i) => c.members.forEach((id) => cycleOf.set(id, i)));
  const coupling = classCoupling(graph);
  const layers = resolveLayers(model, opts.layers);
  const layerOf = layerIndexOf(model, layers.order);
  const violations = findLayerViolations(graph, layerOf);
  const violationKeys = new Set(violations.map((v) => `${v.source}\u0001${v.target}`));
  return {
    graph,
    cycles,
    cycleOf,
    packageCycles: findCycles(packageGraph(model, graph)),
    selfLoops: graph.selfLoops,
    coupling,
    topCoupled: topCoupled(coupling, TOP_COUPLED),
    packages: packageMetrics(model, graph),
    categories: categoryCounts(model),
    inheritance: inheritanceDepth(model, opts),
    layers,
    layerOf,
    violations,
    isCycleEdge: (a, b) => {
      const i = cycleOf.get(a);
      return i !== undefined && i === cycleOf.get(b) && (graph.out.get(a)?.includes(b) ?? false);
    },
    isViolationEdge: (a, b) => violationKeys.has(`${a}\u0001${b}`),
  };
}

const cache = new WeakMap<DiagramModel, Map<string, DiagramAnalysis>>();

/** Análisis memoizado por instancia de modelo (inmutable) y opciones. */
export function analyzeDiagram(model: DiagramModel, opts: AnalyzeOptions = {}): DiagramAnalysis {
  const key = `${opts.includeExternal === true ? 1 : 0}\u0001${(opts.layers ?? []).join('\u0002')}`;
  let byKey = cache.get(model);
  if (!byKey) cache.set(model, (byKey = new Map()));
  let a = byKey.get(key);
  if (!a) byKey.set(key, (a = computeAnalysis(model, opts)));
  return a;
}
