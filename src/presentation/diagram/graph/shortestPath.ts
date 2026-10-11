// src/presentation/diagram/graph/shortestPath.ts — ruta más corta entre dos clases (puro).
// Grafo sin pesos ⇒ BFS: óptimo en número de saltos y O(n + m). Dirigido sigue source → target (ver
// adjacency.ts); no dirigido usa salientes y entrantes. Los vecinos están ordenados por id y el primer
// descubrimiento fija el padre, así que ante un empate el resultado es siempre el mismo.
import type { LayoutResult } from '../types';
import type { Adjacency } from './adjacency';
import type { Focus } from './focus';

/** Ids del camino de `from` a `to` (ambos incluidos), o null si no hay camino o algún id no existe. */
export function shortestPath(adj: Adjacency, from: string, to: string, directed: boolean): string[] | null {
  if (!adj.nodes.has(from) || !adj.nodes.has(to)) return null;
  if (from === to) return [from];
  const parent = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head] as string;
    const lists = directed ? [adj.out.get(u)] : [adj.out.get(u), adj.in.get(u)];
    // No dirigido: se fusionan las dos listas en orden de id para que el empate no dependa del sentido.
    const neighbors = directed ? (lists[0] ?? []) : [...(lists[0] ?? []), ...(lists[1] ?? [])].sort();
    for (const v of neighbors) {
      if (parent.has(v)) continue;
      parent.set(v, u);
      if (v === to) {
        const path = [to];
        for (let c = u; c !== from; c = parent.get(c) as string) path.push(c);
        path.push(from);
        return path.reverse();
      }
      queue.push(v);
    }
  }
  return null;
}

/**
 * Lo que se resalta de un camino en el layout: sus nodos y las aristas entre pares consecutivos (en
 * cualquier sentido, o solo en el del camino si es dirigido). Con el mismo formato que el foco de selección.
 */
export function pathFocus(layout: LayoutResult, path: readonly string[], directed = false): Focus {
  const nodes = new Set(path);
  const pairs = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as string;
    const b = path[i] as string;
    pairs.add(a + '\u0000' + b);
    if (!directed) pairs.add(b + '\u0000' + a);
  }
  const edges = new Set<number>();
  if (pairs.size > 0) layout.edges.forEach((e, i) => {
    if (pairs.has(e.source + '\u0000' + e.target)) edges.add(i);
  });
  return { nodes, edges };
}
