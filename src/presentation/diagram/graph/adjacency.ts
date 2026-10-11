// src/presentation/diagram/graph/adjacency.ts — listas de adyacencia del modelo, una sola vez por modelo (puro).
//
// Decisión de dirección (T8): una arista va de `source` a `target` tal como la guarda el modelo. En
// EXTENDS/IMPLEMENTS `source` es el hijo y depende del padre (`target`); en COMPOSITION/AGGREGATION
// `source` es el todo. "Saliente" = de source a target; "entrante" = al revés. La clase asociación de
// "(A, B) .. C" no es una arista de dependencia: la relación A–B cuenta, pero C no queda enlazada con A
// ni con B. Los bucles (A → A) no aportan nada a recorridos y se ignoran.
//
// Representación: Map<id, id[]> sin duplicados y ORDENADO por id. O(n + m) en memoria, recorridos en
// O(n + m), y el orden fijo hace deterministas los empates de BFS aunque cambie el orden de declaración.
import type { DiagramModel } from '../../../domain/diagram/model';

export interface Adjacency {
  /** Ids de los tipos del modelo. */
  nodes: ReadonlySet<string>;
  out: ReadonlyMap<string, readonly string[]>;
  in: ReadonlyMap<string, readonly string[]>;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function push(map: Map<string, Set<string>>, from: string, to: string): void {
  let set = map.get(from);
  if (!set) {
    set = new Set();
    map.set(from, set);
  }
  set.add(to);
}

function freeze(map: Map<string, Set<string>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [k, set] of map) out.set(k, [...set].sort(byId));
  return out;
}

export function buildAdjacency(model: DiagramModel): Adjacency {
  const nodes = new Set(model.types.map((t) => t.id));
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  for (const r of model.relationships) {
    if (r.source === r.target || !nodes.has(r.source) || !nodes.has(r.target)) continue;
    push(out, r.source, r.target);
    push(inc, r.target, r.source);
  }
  return { nodes, out: freeze(out), in: freeze(inc) };
}

const cache = new WeakMap<DiagramModel, Adjacency>();

/** Adyacencia memoizada por instancia de modelo (los modelos son inmutables). */
export function adjacencyOf(model: DiagramModel): Adjacency {
  let adj = cache.get(model);
  if (!adj) {
    adj = buildAdjacency(model);
    cache.set(model, adj);
  }
  return adj;
}
