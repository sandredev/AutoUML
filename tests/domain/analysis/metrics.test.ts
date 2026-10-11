// tests/domain/analysis/metrics.test.ts — clases por categoría y profundidad de herencia (T9).
import { describe, expect, it } from 'vitest';
import { categoryCounts, inheritanceDepth } from '../../../src/domain/analysis/metrics';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

describe('inheritanceDepth', () => {
  it('sin herencia: profundidad 0', () => {
    const m = diagram([typeNode('A'), typeNode('B')], [rel('A', 'B')]);
    expect(inheritanceDepth(m)).toEqual({ depth: 0, chain: [] });
  });

  it('cadena C → B → A más IMPLEMENTS: profundidad 3 y cadena del más profundo a la raíz', () => {
    const m = diagram(
      [typeNode('A'), typeNode('B'), typeNode('C'), typeNode('I'), typeNode('X')],
      [
        rel('B', 'A', { type: 'EXTENDS' }),
        rel('C', 'B', { type: 'EXTENDS' }),
        rel('A', 'I', { type: 'IMPLEMENTS' }),
        rel('X', 'A', { type: 'EXTENDS' }),
        rel('C', 'X'), // una asociación no es herencia
      ],
    );
    expect(inheritanceDepth(m)).toEqual({ depth: 3, chain: ['C', 'B', 'A', 'I'] });
  });

  it('ciclo de herencia: termina y cuenta el ciclo como un nivel', () => {
    const m = diagram(
      [typeNode('A'), typeNode('B'), typeNode('C')],
      [rel('A', 'B', { type: 'EXTENDS' }), rel('B', 'A', { type: 'EXTENDS' }), rel('C', 'A', { type: 'EXTENDS' })],
    );
    const r = inheritanceDepth(m);
    expect(r.depth).toBe(1);
    expect(r.chain[0]).toBe('C');
  });
});

describe('categoryCounts', () => {
  it('cuenta todos los tipos del modelo por categoría', () => {
    const m = diagram([
      typeNode('A'),
      typeNode('B'),
      typeNode('I', { category: 'interface' }),
      typeNode('E', { category: 'external', isExternal: true }),
    ]);
    expect(categoryCounts(m)).toEqual({ class: 2, interface: 1, external: 1 });
  });
});
