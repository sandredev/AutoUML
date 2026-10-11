// tests/presentation/diagram/graph/filters.test.ts — filtros semánticos del visor (T8).
import { describe, expect, it } from 'vitest';
import type { SidecarFilters } from '../../../../src/application/ports/ipc';
import type { MethodModel } from '../../../../src/domain/diagram/model';
import {
  applyMemberFilters, drawHiddenOf, filterLayout, hasActiveFilters, memberFiltersKey, needsRelayout,
} from '../../../../src/presentation/diagram/graph/filters';
import { PACKAGE_NODE_PREFIX } from '../../../../src/presentation/diagram/layout/aggregate';
import type { LayoutResult } from '../../../../src/presentation/diagram/types';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

const method = (name: string, visibility: MethodModel['visibility'] = '+'): MethodModel =>
  ({ name, returnType: 'void', parameters: [], visibility, isStatic: false, isAbstract: false });

const svc = typeNode('Svc', {
  packageName: 'app',
  attributes: [
    { name: 'pub', type: 'int', visibility: '+', isStatic: false },
    { name: 'prot', type: 'int', visibility: '#', isStatic: false },
    { name: 'pkg', type: 'int', visibility: '~', isStatic: false },
    { name: 'priv', type: 'int', visibility: '-', isStatic: false },
  ],
  methods: [method('run'), method('getName'), method('setName'), method('isReady'), method('island'), method('helper', '-')],
  constructors: [{ name: 'Svc', parameters: [], visibility: '+' }],
});
const model = diagram(
  [svc, typeNode('Repo', { packageName: 'app' }), typeNode('Ext', { category: 'external', packageName: 'lib' }),
    typeNode('Ghost', { category: 'undeclared', packageName: 'lib' }), typeNode('Ui', { packageName: 'ui' })],
  [rel('Svc', 'Repo'), rel('Svc', 'Ext', { type: 'DEPENDENCY' }), rel('Ui', 'Svc'), rel('Svc', 'Ghost', { type: 'EXTENDS' })],
);
const names = (ms: readonly { name: string }[]): string[] => ms.map((m) => m.name);
const typeOf = (m: typeof model, id: string) => m.types.find((t) => t.id === id);

describe('filtros que cambian el tamaño de las tarjetas (modelo, recalculan el layout)', () => {
  it('sin filtros devuelve el MISMO modelo', () => {
    expect(applyMemberFilters(model, {})).toBe(model);
    expect(applyMemberFilters(model, { minVisibility: '-' })).toBe(model);
  });

  it('visibilidad mínima: + solo públicos, # protegidos y públicos, ~ también paquete', () => {
    expect(names(typeOf(applyMemberFilters(model, { minVisibility: '+' }), 'Svc')?.attributes ?? [])).toEqual(['pub']);
    expect(names(typeOf(applyMemberFilters(model, { minVisibility: '#' }), 'Svc')?.attributes ?? [])).toEqual(['pub', 'prot']);
    expect(names(typeOf(applyMemberFilters(model, { minVisibility: '~' }), 'Svc')?.attributes ?? [])).toEqual(['pub', 'prot', 'pkg']);
    expect(names(typeOf(applyMemberFilters(model, { minVisibility: '+' }), 'Svc')?.methods ?? [])).not.toContain('helper');
  });

  it('ocultar getters/setters: get/set/is + mayúscula (island no es un accesor)', () => {
    const f = applyMemberFilters(model, { hideAccessors: true });
    expect(names(typeOf(f, 'Svc')?.methods ?? [])).toEqual(['run', 'island', 'helper']);
  });

  it('ocultar constructores', () => {
    expect(typeOf(applyMemberFilters(model, { hideConstructors: true }), 'Svc')?.constructors).toEqual([]);
  });

  it('combinados; los tipos que no cambian conservan su identidad', () => {
    const f = applyMemberFilters(model, { minVisibility: '+', hideAccessors: true, hideConstructors: true });
    const s = typeOf(f, 'Svc');
    expect(names(s?.attributes ?? [])).toEqual(['pub']);
    expect(names(s?.methods ?? [])).toEqual(['run', 'island']);
    expect(s?.constructors).toEqual([]);
    expect(typeOf(f, 'Repo')).toBe(typeOf(model, 'Repo'));
  });
});

describe('clave de recálculo', () => {
  const sizeOnes: SidecarFilters[] = [{ minVisibility: '#' }, { hideAccessors: true }, { hideConstructors: true }];
  const drawOnes: SidecarFilters[] = [
    { hiddenRelTypes: ['DEPENDENCY'] }, { hideExternal: true }, { hideUndeclared: true }, { hiddenPackages: ['ui'] }, { hiddenTypes: ['Repo'] },
  ];

  it('los filtros de tamaño marcan "recalcular"', () => {
    for (const f of sizeOnes) expect(needsRelayout({}, f)).toBe(true);
  });

  it('los de dibujo no', () => {
    for (const f of drawOnes) expect(needsRelayout({}, f)).toBe(false);
    expect(memberFiltersKey({ hideExternal: true, hiddenPackages: ['x'] })).toBe(memberFiltersKey({}));
  });

  it('visibilidad "-" equivale a sin filtro', () => {
    expect(needsRelayout({}, { minVisibility: '-' })).toBe(false);
  });

  it('hasActiveFilters', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ minVisibility: '-', hiddenPackages: [], hideExternal: false })).toBe(false);
    for (const f of [...sizeOnes, ...drawOnes]) expect(hasActiveFilters(f)).toBe(true);
  });
});

describe('filtros de dibujo (no recalculan: ocultan al dibujar)', () => {
  it('sin filtros de dibujo: null', () => {
    expect(drawHiddenOf(model, {})).toBeNull();
    expect(drawHiddenOf(model, { hideAccessors: true })).toBeNull();
  });

  it('externos, sin declarar, paquetes y clases sueltas', () => {
    expect([...(drawHiddenOf(model, { hideExternal: true })?.nodes ?? [])]).toEqual(['Ext']);
    expect([...(drawHiddenOf(model, { hideUndeclared: true })?.nodes ?? [])]).toEqual(['Ghost']);
    expect([...(drawHiddenOf(model, { hiddenPackages: ['app'] })?.nodes ?? [])].sort()).toEqual(['Repo', 'Svc']);
    expect([...(drawHiddenOf(model, { hiddenTypes: ['Ui'] })?.nodes ?? [])]).toEqual(['Ui']);
  });

  it('tipos de relación', () => {
    const h = drawHiddenOf(model, { hiddenRelTypes: ['DEPENDENCY', 'EXTENDS'] });
    expect([...(h?.relTypes ?? [])].sort()).toEqual(['DEPENDENCY', 'EXTENDS']);
    expect(h?.nodes.size).toBe(0);
  });

  it('combinados', () => {
    const h = drawHiddenOf(model, { hideExternal: true, hideUndeclared: true, hiddenPackages: ['ui'] });
    expect([...(h?.nodes ?? [])].sort()).toEqual(['Ext', 'Ghost', 'Ui']);
  });

  it('un paquete plegado desmarcado también se oculta', () => {
    const pkg = PACKAGE_NODE_PREFIX + 'app';
    const agg = diagram([typeNode(pkg, { packageName: '' }), typeNode('Ui', { packageName: 'ui' })]);
    expect([...(drawHiddenOf(agg, { hiddenPackages: ['app'] })?.nodes ?? [])]).toEqual([pkg]);
  });
});

describe('filterLayout', () => {
  const box = (id: string) => ({ id, x: 0, y: 0, w: 10, h: 10 });
  const edge = (source: string, target: string, type: string) => ({ source, target, type, points: [] });
  const layout = {
    nodes: ['Svc', 'Repo', 'Ext', 'Ghost', 'Ui'].map(box),
    edges: [edge('Svc', 'Repo', 'ASSOCIATION'), edge('Svc', 'Ext', 'DEPENDENCY'), edge('Ui', 'Svc', 'ASSOCIATION'), edge('Svc', 'Ghost', 'EXTENDS')],
    packages: [{ name: 'app', x: 0, y: 0, w: 1, h: 1 }, { name: 'lib', x: 0, y: 0, w: 1, h: 1 }, { name: 'ui', x: 0, y: 0, w: 1, h: 1 }],
    notes: [{ id: 'n', x: 0, y: 0, w: 1, h: 1, lines: [], anchor: 'Ui' }, { id: 'libre', x: 0, y: 0, w: 1, h: 1, lines: [] }],
    bounds: { x: 0, y: 0, w: 100, h: 100 },
  } as unknown as LayoutResult;

  it('sin nada oculto devuelve el MISMO layout', () => {
    expect(filterLayout(layout, model, null)).toBe(layout);
  });

  it('quita nodos ocultos, sus aristas, sus notas y los paquetes que se quedan vacíos; conserva bounds', () => {
    const h = drawHiddenOf(model, { hideExternal: true, hideUndeclared: true, hiddenPackages: ['ui'] });
    const f = filterLayout(layout, model, h);
    expect(f.nodes.map((n) => n.id)).toEqual(['Svc', 'Repo']);
    expect(f.edges.map((e) => `${e.source}-${e.target}`)).toEqual(['Svc-Repo']);
    expect(f.packages.map((p) => p.name)).toEqual(['app']);
    expect((f.notes ?? []).map((n) => n.id)).toEqual(['libre']);
    expect(f.bounds).toBe(layout.bounds);
  });

  it('tipos de relación: solo quita esas aristas', () => {
    const f = filterLayout(layout, model, drawHiddenOf(model, { hiddenRelTypes: ['DEPENDENCY'] }));
    expect(f.nodes).toHaveLength(5);
    expect(f.edges.map((e) => e.type)).toEqual(['ASSOCIATION', 'ASSOCIATION', 'EXTENDS']);
  });
});
