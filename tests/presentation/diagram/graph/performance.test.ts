// tests/presentation/diagram/graph/performance.test.ts — foco y ruta con 1000 clases / 2000 relaciones en < 50 ms (T8).
import { describe, expect, it } from 'vitest';
import type { RelationshipModel } from '../../../../src/domain/diagram/model';
import { buildAdjacency } from '../../../../src/presentation/diagram/graph/adjacency';
import { applyFocus, neighborhood } from '../../../../src/presentation/diagram/graph/neighborhood';
import { shortestPath } from '../../../../src/presentation/diagram/graph/shortestPath';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

const N = 1000;
const M = 2000;

/** Generador congruencial: grafo pseudoaleatorio pero reproducible. */
function bigModel() {
  let seed = 42;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const types = Array.from({ length: N }, (_, i) => typeNode('T' + i, { packageName: 'p' + (i % 20) }));
  const relationships: RelationshipModel[] = [];
  // Cadena que conecta todo + aristas al azar hasta M.
  for (let i = 1; i < N; i++) relationships.push(rel('T' + (i - 1), 'T' + i));
  while (relationships.length < M) relationships.push(rel('T' + Math.floor(rnd() * N), 'T' + Math.floor(rnd() * N)));
  return diagram(types, relationships);
}

const timed = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe('rendimiento (1000 nodos / 2000 aristas)', () => {
  const model = bigModel();

  it('adyacencia + vecindario a 3 saltos + applyFocus en < 50 ms', () => {
    let size = 0;
    const ms = timed(() => {
      const adj = buildAdjacency(model);
      size = neighborhood(adj, 'T500', 3, 'both')?.size ?? 0;
      applyFocus(model, { id: 'T500', depth: 3, direction: 'both' });
    });
    expect(size).toBeGreaterThan(1);
    expect(ms).toBeLessThan(50);
  });

  it('adyacencia + ruta del primero al último (dirigida y no dirigida) en < 50 ms', () => {
    let len = 0;
    const ms = timed(() => {
      const adj = buildAdjacency(model);
      len = shortestPath(adj, 'T0', 'T999', true)?.length ?? 0;
      shortestPath(adj, 'T999', 'T0', false);
    });
    expect(len).toBeGreaterThan(1);
    expect(ms).toBeLessThan(50);
  });
});
