// src/domain/analysis/graph.ts — grafo de dependencias entre tipos para el análisis de arquitectura (T9). Puro.
//
// Qué es una dependencia: `source → target` para TODOS los tipos de relación, tal como los guarda el modelo
// (en EXTENDS/IMPLEMENTS `source` es el hijo y depende del padre; en COMPOSITION/AGGREGATION `source` es el
// todo y depende de la parte). Mismo criterio que la adyacencia de T8.
//   - Aristas paralelas (A → B dos veces, o con tipos distintos) cuentan UNA vez: las métricas cuentan clases
//     distintas, no relaciones.
//   - Las autorreferencias (A → A) no son aristas: se listan en `selfLoops` como aviso aparte.
//   - La relación que lleva `associationClass` ("(A, B) .. C") no es una dependencia: enlaza la clase
//     asociación con un par; la relación A–B, si existe, se declara aparte y esa sí cuenta.
//   - Las notas no son relaciones del modelo, así que nunca entran.
//   - Por defecto se excluyen los tipos `isExternal` e `implicit` (no declarados en el documento): el análisis
//     habla de la arquitectura que el documento describe, no de las librerías que usa. `includeExternal: true`
//     los incluye.
import type { DiagramModel, TypeNode } from '../diagram/model';

export interface AnalysisOptions {
  /** Incluir tipos externos e implícitos. Por defecto false. */
  includeExternal?: boolean;
}

/** Grafo dirigido con listas de adyacencia ordenadas y sin duplicados. */
export interface Digraph {
  /** Nodos ordenados por id. */
  nodes: readonly string[];
  out: ReadonlyMap<string, readonly string[]>;
  in: ReadonlyMap<string, readonly string[]>;
  /** Número de aristas distintas (sin autorreferencias). */
  edgeCount: number;
  /** Nodos con autorreferencia, ordenados. */
  selfLoops: readonly string[];
}

export const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function isAnalyzedType(t: TypeNode, opts: AnalysisOptions = {}): boolean {
  return opts.includeExternal === true || (!t.isExternal && !t.implicit);
}

/** Construye un Digraph a partir de pares (from, to); los extremos que no estén en `nodes` se ignoran. */
export function digraphOf(nodes: Iterable<string>, pairs: Iterable<readonly [string, string]>): Digraph {
  const known = new Set(nodes);
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  const self = new Set<string>();
  let edgeCount = 0;
  for (const [a, b] of pairs) {
    if (!known.has(a) || !known.has(b)) continue;
    if (a === b) {
      self.add(a);
      continue;
    }
    let s = out.get(a);
    if (!s) out.set(a, (s = new Set()));
    if (s.has(b)) continue;
    s.add(b);
    edgeCount++;
    let t = inc.get(b);
    if (!t) inc.set(b, (t = new Set()));
    t.add(a);
  }
  const freeze = (m: Map<string, Set<string>>): Map<string, string[]> =>
    new Map([...m].map(([k, v]) => [k, [...v].sort(byId)]));
  return { nodes: [...known].sort(byId), out: freeze(out), in: freeze(inc), edgeCount, selfLoops: [...self].sort(byId) };
}

export function buildDependencyGraph(model: DiagramModel, opts: AnalysisOptions = {}): Digraph {
  const nodes = model.types.filter((t) => isAnalyzedType(t, opts)).map((t) => t.id);
  const pairs = model.relationships
    .filter((r) => r.associationClass === undefined)
    .map((r) => [r.source, r.target] as const);
  return digraphOf(nodes, pairs);
}
