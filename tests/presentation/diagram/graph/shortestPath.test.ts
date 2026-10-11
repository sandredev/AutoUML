// tests/presentation/diagram/graph/shortestPath.test.ts — camino más corto entre dos clases (BFS, T8).
import { describe, expect, it } from 'vitest';
import { buildAdjacency } from '../../../../src/presentation/diagram/graph/adjacency';
import { pathFocus, shortestPath } from '../../../../src/presentation/diagram/graph/shortestPath';
import type { LayoutResult } from '../../../../src/presentation/diagram/types';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

// A → B → C, A → D → C (empate de longitud 2), E → A, F aislado.
const m = diagram(
  ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => typeNode(id)),
  [rel('A', 'D'), rel('D', 'C'), rel('A', 'B'), rel('B', 'C'), rel('E', 'A')],
);
const adj = buildAdjacency(m);

describe('shortestPath', () => {
  it('dirigido: sigue source → target', () => {
    expect(shortestPath(adj, 'E', 'C', true)).toHaveLength(4);
    expect(shortestPath(adj, 'C', 'E', true)).toBeNull();
  });

  it('no dirigido: encuentra el camino aunque vaya contra las flechas', () => {
    expect(shortestPath(adj, 'C', 'E', false)).toEqual(['C', 'B', 'A', 'E']);
  });

  it('empate: resultado determinista (vecinos en orden de id)', () => {
    expect(shortestPath(adj, 'A', 'C', true)).toEqual(['A', 'B', 'C']);
    // Con las relaciones declaradas en otro orden sale lo mismo.
    const other = buildAdjacency(diagram(m.types, [...m.relationships].reverse()));
    expect(shortestPath(other, 'A', 'C', true)).toEqual(['A', 'B', 'C']);
  });

  it('sin camino: null', () => {
    expect(shortestPath(adj, 'A', 'F', false)).toBeNull();
  });

  it('A == B: el camino es solo A', () => {
    expect(shortestPath(adj, 'A', 'A', true)).toEqual(['A']);
  });

  it('id inexistente: null', () => {
    expect(shortestPath(adj, 'A', 'Nadie', false)).toBeNull();
    expect(shortestPath(adj, 'Nadie', 'A', false)).toBeNull();
  });
});

describe('pathFocus', () => {
  const edge = (source: string, target: string) => ({ source, target, type: 'ASSOCIATION' as const, points: [] });
  const layout = {
    nodes: [],
    edges: [edge('A', 'B'), edge('C', 'B'), edge('B', 'C'), edge('X', 'Y')],
    bounds: { x: 0, y: 0, w: 0, h: 0 },
  } as unknown as LayoutResult;

  it('marca los nodos del camino y TODAS las aristas entre pares consecutivos (en cualquier sentido)', () => {
    const f = pathFocus(layout, ['A', 'B', 'C']);
    expect([...f.nodes]).toEqual(['A', 'B', 'C']);
    expect([...f.edges].sort()).toEqual([0, 1, 2]);
  });

  it('dirigido: solo las aristas en el sentido del camino', () => {
    const f = pathFocus(layout, ['A', 'B', 'C'], true);
    expect([...f.edges].sort()).toEqual([0, 2]);
  });

  it('camino de un solo nodo: sin aristas', () => {
    const f = pathFocus(layout, ['A']);
    expect([...f.edges]).toEqual([]);
  });
});
