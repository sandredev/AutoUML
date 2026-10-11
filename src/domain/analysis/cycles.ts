// src/domain/analysis/cycles.ts — ciclos de dependencias: componentes fuertemente conexos (Tarjan) (T9). Puro.
//
// Tarjan ITERATIVO (pila explícita) con Set para "en pila": O(n + m) y sin desbordar la pila de llamadas con
// cadenas largas. Un componente de 2 o más nodos es un ciclo; los de un nodo no (las autorreferencias se
// informan aparte en `Digraph.selfLoops`). Todo es determinista: nodos y adyacencias van ordenados por id.
import type { DiagramModel } from '../diagram/model';
import { byId, digraphOf, type Digraph } from './graph';

export interface Cycle {
  /** Miembros del componente, ordenados por id. */
  members: string[];
  /**
   * Un ciclo representativo, cerrado (primero = último): el más corto que sale del menor id y vuelve a él.
   * En un componente con varios ciclos es solo un ejemplo legible; `members` es la lista completa.
   */
  path: string[];
}

/** Componentes fuertemente conexos (todos, también los de un nodo). Cada uno ordenado por id. */
export function stronglyConnected(g: Digraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let next = 0;

  for (const root of g.nodes) {
    if (index.has(root)) continue;
    // Marco de la DFS: nodo y posición en su lista de sucesores.
    const work: Array<{ v: string; i: number }> = [{ v: root, i: 0 }];
    index.set(root, next);
    low.set(root, next);
    next++;
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1] as { v: string; i: number };
      const succ = g.out.get(frame.v) ?? [];
      if (frame.i < succ.length) {
        const w = succ[frame.i++] as string;
        if (!index.has(w)) {
          index.set(w, next);
          low.set(w, next);
          next++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v) as number, index.get(w) as number));
        }
        continue;
      }
      // Todos los sucesores vistos: ¿es raíz de un componente?
      work.pop();
      const v = frame.v;
      if (low.get(v) === index.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop() as string;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        result.push(comp.sort(byId));
      }
      const parent = work[work.length - 1];
      if (parent) low.set(parent.v, Math.min(low.get(parent.v) as number, low.get(v) as number));
    }
  }
  return result;
}

/** Ciclo más corto que sale de `start` y vuelve a él sin salir de `members` (BFS, sucesores por id). */
function shortestCycleFrom(g: Digraph, start: string, members: ReadonlySet<string>): string[] {
  const parent = new Map<string, string>();
  const queue = [start];
  const seen = new Set([start]);
  for (let h = 0; h < queue.length; h++) {
    const u = queue[h] as string;
    const succ = g.out.get(u) ?? [];
    if (u !== start && succ.includes(start)) {
      const path = [u];
      for (let p = parent.get(u); p !== undefined; p = parent.get(p)) path.push(p);
      path.reverse();
      path.push(start);
      return path;
    }
    for (const w of succ) {
      if (!members.has(w) || seen.has(w)) continue;
      if (w === start) continue;
      seen.add(w);
      parent.set(w, u);
      queue.push(w);
    }
  }
  // Inalcanzable en un componente de 2+ nodos (siempre hay camino de vuelta); se deja por tipado.
  return [start, start];
}

/** Ciclos (componentes de 2+ nodos), ordenados por su primer miembro. */
export function findCycles(g: Digraph): Cycle[] {
  return stronglyConnected(g)
    .filter((c) => c.length >= 2)
    .sort((a, b) => byId(a[0] as string, b[0] as string))
    .map((members) => ({ members, path: shortestCycleFrom(g, members[0] as string, new Set(members)) }));
}

/** Grafo agregado por paquete (`TypeNode.packageName`): una arista P → Q si algún tipo de P depende de uno de Q. */
export function packageGraph(model: DiagramModel, g: Digraph): Digraph {
  const pkgOf = new Map(model.types.map((t) => [t.id, t.packageName]));
  const nodes = new Set<string>();
  for (const id of g.nodes) nodes.add(pkgOf.get(id) as string);
  const pairs: Array<[string, string]> = [];
  for (const [a, succ] of g.out) {
    const pa = pkgOf.get(a) as string;
    for (const b of succ) {
      const pb = pkgOf.get(b) as string;
      if (pa !== pb) pairs.push([pa, pb]); // las aristas internas no hacen ciclos entre paquetes
    }
  }
  return digraphOf(nodes, pairs);
}
