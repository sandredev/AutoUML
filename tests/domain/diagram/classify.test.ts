import { describe, expect, it } from 'vitest';
import { parsePuml } from '../../../src/application/puml/parser';
import { buildTree, countByCategory } from '../../../src/domain/diagram/classify';
import { EJEMPLO } from '../../fixtures/sampleDiagram';

describe('classify / countByCategory / buildTree', () => {
  const model = parsePuml(EJEMPLO);

  it('contadores del ejemplo e invariante', () => {
    const c = countByCategory(model);
    expect(c).toMatchObject({
      sealed: 1,
      abstract: 1,
      interface: 1,
      enum: 1,
      record: 1,
      annotation: 0,
      class: 2,
      external: 1,
      undeclared: 0,
      totalInternal: 7,
    });
    expect(c.totalInternal).toBe(c.sealed + c.abstract + c.interface + c.enum + c.record + c.annotation + c.class);
  });

  it('árbol: orden, etiquetas, grupos vacíos y sealed solo en Sealed', () => {
    const tree = buildTree(model);
    expect(tree.map((g) => g.label)).toEqual([
      'Sealed', 'Abstracts', 'Interfaces', 'Enums', 'Records', 'Annotations', 'Clases', 'Externas', 'Sin declarar',
    ]);
    expect(tree.find((g) => g.label === 'Annotations')?.count).toBe(0);
    expect(tree.find((g) => g.label === 'Clases')?.items.map((i) => i.name)).toEqual(['Estudiante', 'Foo']);
    const holders = tree.filter((g) => g.items.some((i) => i.id === 'Figura')).map((g) => g.label);
    expect(holders).toEqual(['Sealed']);
  });
});
