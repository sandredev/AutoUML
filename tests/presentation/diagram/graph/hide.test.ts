import { describe, expect, it } from 'vitest';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';
import { applyHide, parseHide } from '../../../../src/presentation/diagram/graph/hide';

describe('parseHide (T4)', () => {
  it('reconoce las reglas pedidas y un show posterior deshace el hide', () => {
    const r = parseHide([
      'hide empty members', 'hide circle', 'hide stereotype', 'hide <<Entity>>', 'hide @unlinked',
      'hide Foo', 'hide private members', 'show circle', 'hide members',
    ]);
    expect(r.emptyFields && r.emptyMethods).toBe(true);
    expect(r.circle).toBe(false);
    expect(r.stereotype).toBe(true);
    expect([...r.stereotypes]).toEqual(['Entity']);
    expect([...r.types]).toEqual(['Foo']);
    expect(r.unlinked && r.privateMembers).toBe(true);
  });

  it('hide empty fields / empty methods por separado y remove @unlinked', () => {
    const r = parseHide(['hide empty fields', 'remove @unlinked']);
    expect(r.emptyFields).toBe(true);
    expect(r.emptyMethods).toBe(false);
    expect(r.unlinked).toBe(true);
  });
});

describe('applyHide (T4)', () => {
  const model = diagram(
    [
      typeNode('A', {
        attributes: [
          { name: 'secret', type: 'int', visibility: '-', isStatic: false },
          { name: 'open', type: 'int', visibility: '+', isStatic: false },
        ],
        methods: [
          { name: 'hidden', returnType: '', parameters: [], visibility: '-', isStatic: false, isAbstract: false },
          { name: 'run', returnType: '', parameters: [], visibility: '+', isStatic: false, isAbstract: false },
        ],
        constructors: [{ name: 'A', parameters: [], visibility: '-' }],
      }),
      typeNode('B', { stereotypes: ['Entity'] }),
      typeNode('C'),
      typeNode('Lonely'),
    ],
    [rel('A', 'B'), rel('A', 'C'), rel('Lonely', 'Lonely')],
    { notes: [{ id: 'n1', text: 'x', anchor: 'C', line: 9 }, { id: 'n2', text: 'y', line: 10 }] },
  );

  it('sin reglas de filtrado devuelve el mismo modelo', () => {
    const out = applyHide(model, parseHide(['hide circle']));
    expect(out.model).toBe(model);
    expect(out.display.showCircle).toBe(false);
  });

  it('hide private members filtra attributes/methods/constructors (no "fields")', () => {
    const out = applyHide(model, parseHide(['hide private members']));
    const a = out.model.types.find((t) => t.id === 'A');
    expect(a?.attributes.map((x) => x.name)).toEqual(['open']);
    expect(a?.methods.map((x) => x.name)).toEqual(['run']);
    expect(a?.constructors).toEqual([]);
    expect(model.types[0]?.attributes).toHaveLength(2); // sin mutar el original
  });

  it('hide <<X>>, hide Clase y hide @unlinked quitan tipos con sus relaciones y notas', () => {
    const out = applyHide(model, parseHide(['hide <<Entity>>', 'hide C', 'hide @unlinked']));
    expect(out.model.types.map((t) => t.id)).toEqual(['A']);
    expect(out.model.relationships).toEqual([]);
    expect(out.model.notes?.map((n) => n.id)).toEqual(['n2']);
    expect(out.model.packages[0]?.typeIds).toEqual(['A']);
  });

  it('un bucle no cuenta como enlace para @unlinked', () => {
    const out = applyHide(model, parseHide(['remove @unlinked']));
    expect(out.model.types.map((t) => t.id)).toEqual(['A', 'B', 'C']);
  });

  it('classAttributeIconSize 0 llega a display', () => {
    expect(applyHide(model, parseHide([]), false).display.visibilityIcons).toBe(false);
  });
});
