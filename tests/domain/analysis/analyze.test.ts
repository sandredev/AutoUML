// tests/domain/analysis/analyze.test.ts — análisis completo memoizado y su presupuesto de tiempo (T9).
import { describe, expect, it } from 'vitest';
import { analyzeDiagram } from '../../../src/domain/analysis/analyze';
import type { RelationshipModel } from '../../../src/domain/diagram/model';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

describe('analyzeDiagram', () => {
  it('reúne ciclos, autorreferencias, métricas y capas', () => {
    const m = diagram(
      [typeNode('A', { packageName: 'p' }), typeNode('B', { packageName: 'q' }), typeNode('C', { packageName: 'q' })],
      [rel('A', 'B'), rel('B', 'A'), rel('C', 'C'), rel('C', 'A', { type: 'EXTENDS' })],
    );
    const a = analyzeDiagram(m);
    expect(a.cycles.map((c) => c.members)).toEqual([['A', 'B']]);
    expect(a.packageCycles.map((c) => c.members)).toEqual([['p', 'q']]);
    expect(a.selfLoops).toEqual(['C']);
    expect(a.cycleOf.get('A')).toBe(0);
    expect(a.cycleOf.has('C')).toBe(false);
    expect(a.isCycleEdge('A', 'B')).toBe(true);
    expect(a.isCycleEdge('C', 'A')).toBe(false);
    expect(a.inheritance.depth).toBe(1);
    expect(a.layers.source).toBe('none');
    expect(a.violations).toEqual([]);
  });

  it('memoizado por modelo y opciones', () => {
    const m = diagram([typeNode('A')]);
    expect(analyzeDiagram(m)).toBe(analyzeDiagram(m));
    expect(analyzeDiagram(m, { layers: ['x'] })).toBe(analyzeDiagram(m, { layers: ['x'] }));
    expect(analyzeDiagram(m, { layers: ['x'] })).not.toBe(analyzeDiagram(m));
  });

  it('1000 clases / 3000 relaciones en < 100 ms', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const N = 1000;
    const types = Array.from({ length: N }, (_, i) => typeNode('T' + i, { packageName: 'p' + (i % 25) }));
    const rels: RelationshipModel[] = [];
    for (let i = 1; i < N; i++) rels.push(rel('T' + (i - 1), 'T' + i, { type: i % 7 === 0 ? 'EXTENDS' : 'ASSOCIATION' }));
    while (rels.length < 3000) rels.push(rel('T' + Math.floor(rnd() * N), 'T' + Math.floor(rnd() * N)));
    const m = diagram(types, rels);
    const t0 = performance.now();
    const a = analyzeDiagram(m);
    const ms = performance.now() - t0;
    expect(a.graph.nodes).toHaveLength(N);
    expect(ms).toBeLessThan(100);
  });
});
