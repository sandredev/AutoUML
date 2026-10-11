// tests/domain/analysis/cycles.test.ts — componentes fuertemente conexos y ciclos (T9).
import { describe, expect, it } from 'vitest';
import { findCycles, packageGraph, stronglyConnected } from '../../../src/domain/analysis/cycles';
import { buildDependencyGraph, type Digraph } from '../../../src/domain/analysis/graph';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

/** Grafo a partir de pares "A>B". */
function g(nodes: string[], edges: string[]): Digraph {
  const m = diagram(nodes.map((n) => typeNode(n)), edges.map((e) => {
    const [a, b] = e.split('>');
    return rel(a as string, b as string);
  }));
  return buildDependencyGraph(m);
}

describe('stronglyConnected / findCycles', () => {
  it('grafo sin ciclos: ningún ciclo, cada nodo su propio componente', () => {
    const graph = g(['A', 'B', 'C'], ['A>B', 'B>C', 'A>C']);
    expect(findCycles(graph)).toEqual([]);
    expect(stronglyConnected(graph)).toHaveLength(3);
  });

  it('un ciclo de 3: miembros ordenados y camino cerrado desde el menor id', () => {
    const graph = g(['C', 'B', 'A', 'D'], ['A>B', 'B>C', 'C>A', 'C>D']);
    const cycles = findCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toEqual(['A', 'B', 'C']);
    expect(cycles[0]?.path).toEqual(['A', 'B', 'C', 'A']);
  });

  it('dos ciclos disjuntos, ordenados por su primer miembro', () => {
    const graph = g(['X', 'Y', 'A', 'B'], ['Y>X', 'X>Y', 'B>A', 'A>B', 'A>X']);
    expect(findCycles(graph).map((c) => c.members)).toEqual([['A', 'B'], ['X', 'Y']]);
  });

  it('dos ciclos que comparten un nodo forman UN componente', () => {
    const graph = g(['A', 'B', 'C'], ['A>B', 'B>A', 'A>C', 'C>A']);
    const cycles = findCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toEqual(['A', 'B', 'C']);
    // Camino representativo: el más corto que vuelve al primero (empate → orden por id).
    expect(cycles[0]?.path).toEqual(['A', 'B', 'A']);
  });

  it('una autorreferencia no es un ciclo de la lista', () => {
    const graph = buildDependencyGraph(diagram([typeNode('A'), typeNode('B')], [rel('A', 'A'), rel('A', 'B')]));
    expect(findCycles(graph)).toEqual([]);
    expect(graph.selfLoops).toEqual(['A']);
  });

  it('componentes indexados por nodo para marcar las aristas del ciclo', () => {
    const graph = g(['A', 'B', 'C'], ['A>B', 'B>A', 'B>C']);
    const cycles = findCycles(graph);
    const comp = new Map<string, number>();
    cycles.forEach((c, i) => c.members.forEach((m) => comp.set(m, i)));
    expect(comp.get('A')).toBe(comp.get('B'));
    expect(comp.has('C')).toBe(false);
  });

  it('cadena profunda (20 000 nodos) sin desbordar la pila', () => {
    const n = 20000;
    const nodes = Array.from({ length: n }, (_, i) => 'N' + String(i).padStart(5, '0'));
    const edges = nodes.slice(1).map((id, i) => `${nodes[i]}>${id}`);
    edges.push(`${nodes[n - 1]}>${nodes[0]}`);
    const cycles = findCycles(g(nodes, edges));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toHaveLength(n);
    expect(cycles[0]?.path).toHaveLength(n + 1);
  });
});

describe('packageGraph', () => {
  it('agrega por paquete e ignora las aristas internas', () => {
    const m = diagram(
      [typeNode('A1', { packageName: 'a' }), typeNode('A2', { packageName: 'a' }), typeNode('B1', { packageName: 'b' })],
      [rel('A1', 'A2'), rel('A2', 'B1'), rel('B1', 'A1')],
    );
    const pg = packageGraph(m, buildDependencyGraph(m));
    expect(pg.nodes).toEqual(['a', 'b']);
    expect(pg.out.get('a')).toEqual(['b']);
    expect(pg.selfLoops).toEqual([]);
    expect(findCycles(pg).map((c) => c.path)).toEqual([['a', 'b', 'a']]);
  });
});
