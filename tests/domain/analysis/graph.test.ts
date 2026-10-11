// tests/domain/analysis/graph.test.ts — grafo de dependencias que usa el análisis de arquitectura (T9).
import { describe, expect, it } from 'vitest';
import { buildDependencyGraph } from '../../../src/domain/analysis/graph';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

describe('buildDependencyGraph', () => {
  it('una arista source → target por tipo de relación, deduplicada y ordenada', () => {
    const m = diagram(
      [typeNode('C'), typeNode('A'), typeNode('B')],
      [rel('A', 'C'), rel('A', 'B', { type: 'EXTENDS' }), rel('A', 'B', { type: 'DEPENDENCY' }), rel('B', 'C', { type: 'COMPOSITION' })],
    );
    const g = buildDependencyGraph(m);
    expect(g.nodes).toEqual(['A', 'B', 'C']);
    expect(g.out.get('A')).toEqual(['B', 'C']);
    expect(g.in.get('C')).toEqual(['A', 'B']);
    expect(g.edgeCount).toBe(3);
  });

  it('las autorreferencias no son aristas: se listan aparte', () => {
    const g = buildDependencyGraph(diagram([typeNode('A'), typeNode('B')], [rel('B', 'B'), rel('A', 'A'), rel('A', 'A')]));
    expect(g.out.get('A') ?? []).toEqual([]);
    expect(g.selfLoops).toEqual(['A', 'B']);
  });

  it('excluye por defecto los tipos externos e implícitos (y sus aristas)', () => {
    const m = diagram(
      [typeNode('A'), typeNode('Ext', { isExternal: true }), typeNode('Imp', { implicit: true })],
      [rel('A', 'Ext'), rel('Imp', 'A')],
    );
    const g = buildDependencyGraph(m);
    expect(g.nodes).toEqual(['A']);
    expect(g.edgeCount).toBe(0);
    const all = buildDependencyGraph(m, { includeExternal: true });
    expect(all.nodes).toEqual(['A', 'Ext', 'Imp']);
    expect(all.edgeCount).toBe(2);
  });

  it('la relación de una clase asociación no cuenta como dependencia', () => {
    const m = diagram([typeNode('A'), typeNode('B'), typeNode('C')], [rel('A', 'B', { associationClass: 'C' })]);
    expect(buildDependencyGraph(m).edgeCount).toBe(0);
  });

  it('ignora relaciones con extremos que no son tipos del modelo', () => {
    const g = buildDependencyGraph(diagram([typeNode('A')], [rel('A', 'Fantasma')]));
    expect(g.edgeCount).toBe(0);
  });
});
