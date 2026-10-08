import { describe, expect, it } from 'vitest';
import type { DiagramModel, TypeNode } from '../core/model';
import { DEFAULT_DETAIL } from './style/contract';
import {
  DEFAULT_VIEW_OPTIONS,
  applyViewOptions,
  loadViewOptions,
  sanitizeViewOptions,
  saveViewOptions,
  toLayoutOptions,
  type KeyValueStorage,
} from './viewOptions';

function makeType(id: string): TypeNode {
  return {
    id,
    name: id,
    packageName: 'x.domain',
    declaredKind: 'class',
    category: 'class',
    isAbstract: false,
    isSealed: false,
    isExternal: false,
    implicit: false,
    stereotypes: [],
    attributes: [{ name: 'nombre', type: 'String', visibility: '-', isStatic: false }],
    methods: [
      { name: 'getNombre', returnType: 'String', parameters: [], visibility: '+', isStatic: false, isAbstract: false },
      { name: 'calcular', returnType: 'int', parameters: [], visibility: '+', isStatic: false, isAbstract: false },
    ],
    constructors: [{ name: id, parameters: [], visibility: '+' }],
    enumConstants: [],
    line: 1,
  };
}

function makeModel(): DiagramModel {
  return {
    types: [makeType('A'), makeType('B')],
    relationships: [],
    packages: [{ name: 'x.domain', typeIds: ['A', 'B'] }],
    summaryMode: false,
    issues: [],
  };
}

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('viewOptions', () => {
  it('sanea valores inválidos a los por defecto', () => {
    expect(sanitizeViewOptions(null)).toEqual(DEFAULT_VIEW_OPTIONS);
    expect(sanitizeViewOptions({ summary: 'x', direction: 'LR', hideAccessors: 1 })).toEqual({ ...DEFAULT_VIEW_OPTIONS, direction: 'LR' });
  });

  it('persiste y recupera', () => {
    const st = memoryStorage();
    saveViewOptions({ ...DEFAULT_VIEW_OPTIONS, hideConstructors: true }, st);
    expect(loadViewOptions(st).hideConstructors).toBe(true);
    st.setItem('autouml.viewOptions.v1', '{roto');
    expect(loadViewOptions(st)).toEqual(DEFAULT_VIEW_OPTIONS);
  });

  it('no copia el modelo si no hay cambios', () => {
    const m = makeModel();
    expect(applyViewOptions(m, DEFAULT_VIEW_OPTIONS)).toBe(m);
  });

  it('filtra constructores y accesores en el modelo compartido', () => {
    const out = applyViewOptions(makeModel(), { ...DEFAULT_VIEW_OPTIONS, hideConstructors: true, hideAccessors: true });
    const a = out.types[0];
    expect(a?.constructors.length).toBe(0);
    expect(a?.methods.map((x) => x.name)).toEqual(['calcular']);
  });

  it('layout y dibujo comparten detail y resumen', () => {
    const m = makeModel();
    const o = { ...DEFAULT_VIEW_OPTIONS, summary: 'compact' as const, direction: 'LR' as const };
    const lo = toLayoutOptions(o, m);
    expect(lo.detail).toBe(DEFAULT_DETAIL);
    expect(lo.direction).toBe('LR');
    expect(lo.summary).toBe(true);
    expect(applyViewOptions(m, o).summaryMode).toBe(true);
  });
});
