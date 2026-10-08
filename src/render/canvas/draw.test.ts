// src/render/canvas/draw.test.ts — partes puras del dibujo (sin Canvas).
import { describe, expect, it } from 'vitest';
import type { TypeNode } from '../../core/model';
import { DEFAULT_DETAIL } from '../style/contract';
import { cardContentOf, fallbackGeometry } from './draw';

function makeType(): TypeNode {
  return {
    id: 'Curso', name: 'Curso', packageName: 'x.domain', declaredKind: 'class', category: 'class',
    isAbstract: false, isSealed: false, isExternal: false, implicit: false, stereotypes: [],
    attributes: [{ name: 'nombre', type: 'String', visibility: '-', isStatic: false }],
    methods: [
      { name: 'getNombre', returnType: 'String', parameters: [], visibility: '+', isStatic: false, isAbstract: false },
      { name: 'of', returnType: 'Curso', parameters: [{ name: 'a', type: 'int' }], visibility: '+', isStatic: true, isAbstract: false },
    ],
    constructors: [{ name: 'Curso', parameters: [{ name: 'a', type: 'int' }], visibility: '+' }],
    enumConstants: [], line: 1,
  };
}

describe('draw', () => {
  it('compone filas y compartimentos', () => {
    const c = cardContentOf(makeType(), DEFAULT_DETAIL);
    expect(c.sections.length).toBe(2);
    expect(c.sections[0]?.[0]?.text).toBe('-nombre: String');
    expect(c.sections[1]?.[0]?.text).toBe('«create» +Curso(a: int)');
    expect(c.sections[1]?.[2]?.isStatic).toBe(true);
  });

  it('oculta accesores y recorta con maxRows', () => {
    const c = cardContentOf(makeType(), { ...DEFAULT_DETAIL, hideAccessors: true, maxRows: 2 });
    const texts = c.sections.flat().map((r) => r.text);
    expect(texts.some((t) => t.startsWith('+getNombre'))).toBe(false);
    expect(c.hidden).toBe(1);
    expect(fallbackGeometry(c).hasMoreRow).toBe(true);
  });
});
