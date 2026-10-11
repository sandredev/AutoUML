// tests/presentation/diagram/graph/neighborhood.test.ts — adyacencia, vecindario a N saltos y modo foco (T8).
import { describe, expect, it } from 'vitest';
import { adjacencyOf, buildAdjacency } from '../../../../src/presentation/diagram/graph/adjacency';
import { applyFocus, focusKey, neighborhood } from '../../../../src/presentation/diagram/graph/neighborhood';
import { aggregateCollapsed, PACKAGE_NODE_PREFIX } from '../../../../src/presentation/diagram/layout/aggregate';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

const sorted = (s: ReadonlySet<string> | null): string[] | null => (s ? [...s].sort() : null);

// Cadena A → B → C → D y E → A (E entra en A). F aislado.
const chain = diagram(
  ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => typeNode(id)),
  [rel('A', 'B'), rel('B', 'C'), rel('C', 'D'), rel('E', 'A')],
);

describe('buildAdjacency', () => {
  it('construye salientes y entrantes sin duplicados, ordenados por id', () => {
    const m = diagram([typeNode('A'), typeNode('B'), typeNode('C')], [rel('A', 'C'), rel('A', 'B'), rel('A', 'B', { type: 'DEPENDENCY' })]);
    const adj = buildAdjacency(m);
    expect(adj.out.get('A')).toEqual(['B', 'C']);
    expect(adj.in.get('B')).toEqual(['A']);
    expect(adj.out.get('B') ?? []).toEqual([]);
  });

  it('EXTENDS: source (hijo) → target (padre); los bucles no son aristas', () => {
    const m = diagram([typeNode('Hijo'), typeNode('Padre')], [rel('Hijo', 'Padre', { type: 'EXTENDS' }), rel('Hijo', 'Hijo')]);
    const adj = buildAdjacency(m);
    expect(adj.out.get('Hijo')).toEqual(['Padre']);
    expect(adj.in.get('Hijo') ?? []).toEqual([]);
  });

  it('la clase asociación no queda enlazada con los extremos (la relación A–B sí cuenta)', () => {
    const m = diagram([typeNode('A'), typeNode('B'), typeNode('C')], [rel('A', 'B', { associationClass: 'C' })]);
    const adj = buildAdjacency(m);
    expect(adj.out.get('A')).toEqual(['B']);
    expect(adj.in.get('C') ?? []).toEqual([]);
    expect(adj.out.get('C') ?? []).toEqual([]);
  });

  it('ignora relaciones con extremos que no son tipos del modelo', () => {
    const m = diagram([typeNode('A')], [rel('A', 'Fantasma')]);
    expect(buildAdjacency(m).out.get('A') ?? []).toEqual([]);
  });

  it('adjacencyOf memoiza por modelo (misma instancia)', () => {
    expect(adjacencyOf(chain)).toBe(adjacencyOf(chain));
  });
});

describe('neighborhood', () => {
  const adj = buildAdjacency(chain);

  it('profundidad 1 en ambas direcciones', () => {
    expect(sorted(neighborhood(adj, 'A', 1, 'both'))).toEqual(['A', 'B', 'E']);
  });

  it('profundidad 2 y 3 saliente', () => {
    expect(sorted(neighborhood(adj, 'A', 2, 'out'))).toEqual(['A', 'B', 'C']);
    expect(sorted(neighborhood(adj, 'A', 3, 'out'))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('entrante sigue las aristas al revés', () => {
    expect(sorted(neighborhood(adj, 'C', 1, 'in'))).toEqual(['B', 'C']);
    expect(sorted(neighborhood(adj, 'C', 3, 'in'))).toEqual(['A', 'B', 'C', 'E']);
  });

  it('ambas recorre el grafo como no dirigido', () => {
    // D ← C ← B ← A ← E: a 2 saltos de B en "both" llegan A, C (1) y E, D (2).
    expect(sorted(neighborhood(adj, 'B', 2, 'both'))).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('ciclos: termina y no repite', () => {
    const cyc = buildAdjacency(diagram([typeNode('X'), typeNode('Y'), typeNode('Z')], [rel('X', 'Y'), rel('Y', 'Z'), rel('Z', 'X')]));
    expect(sorted(neighborhood(cyc, 'X', 3, 'out'))).toEqual(['X', 'Y', 'Z']);
  });

  it('nodo aislado: solo él', () => {
    expect(sorted(neighborhood(adj, 'F', 3, 'both'))).toEqual(['F']);
  });

  it('id inexistente: null', () => {
    expect(neighborhood(adj, 'Nadie', 1, 'both')).toBeNull();
  });

  it('la profundidad se limita a 1–3', () => {
    expect(sorted(neighborhood(adj, 'A', 0, 'out'))).toEqual(['A', 'B']);
    expect(sorted(neighborhood(adj, 'A', 9, 'out'))).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('applyFocus', () => {
  it('sin foco devuelve el MISMO modelo', () => {
    expect(applyFocus(chain, null)).toBe(chain);
  });

  it('deja solo el vecindario, sus relaciones internas, sus paquetes y las notas ancladas a él', () => {
    const m = diagram(
      [typeNode('A', { packageName: 'p' }), typeNode('B', { packageName: 'q' }), typeNode('C', { packageName: 'q' })],
      [rel('A', 'B'), rel('B', 'C')],
      { notes: [{ id: 'n1', text: 'a', anchor: 'A', line: 1 }, { id: 'n2', text: 'c', anchor: 'C', line: 2 }, { id: 'n3', text: 'libre', line: 3 }] },
    );
    const f = applyFocus(m, { id: 'A', depth: 1, direction: 'both' });
    expect(f.types.map((t) => t.id)).toEqual(['A', 'B']);
    expect(f.relationships).toEqual([m.relationships[0]]);
    expect(f.packages.map((p) => [p.name, p.typeIds])).toEqual([['p', ['A']], ['q', ['B']]]);
    expect((f.notes ?? []).map((n) => n.id)).toEqual(['n1']);
  });

  it('quita la clase asociación de una relación si la clase no está en el foco', () => {
    const m = diagram([typeNode('A'), typeNode('B'), typeNode('C')], [rel('A', 'B', { associationClass: 'C' })]);
    const f = applyFocus(m, { id: 'A', depth: 1, direction: 'both' });
    expect(f.types.map((t) => t.id)).toEqual(['A', 'B']);
    expect(f.relationships[0]?.associationClass).toBeUndefined();
  });

  it('foco sobre un id que ya no existe: el modelo tal cual', () => {
    expect(applyFocus(chain, { id: 'Nadie', depth: 1, direction: 'both' })).toBe(chain);
  });

  it('foco sobre un paquete plegado: el nodo del paquete y sus vecinos del modelo agregado', () => {
    const m = diagram(
      [typeNode('A', { packageName: 'app' }), typeNode('B', { packageName: 'app' }), typeNode('C', { packageName: 'core' }), typeNode('D', { packageName: 'ui' })],
      [rel('A', 'C'), rel('B', 'C'), rel('D', 'D')],
    );
    const agg = aggregateCollapsed(m, new Set(['app'])).model;
    const pkg = PACKAGE_NODE_PREFIX + 'app';
    const f = applyFocus(agg, { id: pkg, depth: 1, direction: 'both' });
    expect(f.types.map((t) => t.id).sort()).toEqual([pkg, 'C'].sort());
    expect(f.relationships.every((r) => r.source === pkg && r.target === 'C')).toBe(true);
  });

  it('focusKey distingue id, profundidad y dirección', () => {
    const a = focusKey({ id: 'A', depth: 1, direction: 'both' });
    expect(focusKey(null)).toBe('');
    expect(a).not.toBe(focusKey({ id: 'A', depth: 2, direction: 'both' }));
    expect(a).not.toBe(focusKey({ id: 'A', depth: 1, direction: 'out' }));
    expect(a).not.toBe(focusKey({ id: 'B', depth: 1, direction: 'both' }));
  });
});
