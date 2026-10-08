import { describe, expect, it } from 'vitest';
import type { DiagramModel, TypeNode } from '../../core/model';
import type { LayoutResult } from '../types';
import { applyOverrides, diffOverrides, emptyOverrides, modelSignature, parseOverrides, pruneOverrides, serializeOverrides } from './overrides';
import { finalizeDrop } from './dragNode';

function type(id: string, pkg: string): TypeNode {
  return {
    id, name: id, packageName: pkg, declaredKind: 'class', category: 'class', isAbstract: false, isSealed: false,
    isExternal: false, implicit: false, stereotypes: [], attributes: [], methods: [], constructors: [], enumConstants: [], line: 1,
  };
}

function model(): DiagramModel {
  return {
    types: [type('a', 'p1'), type('b', 'p1'), type('c', 'p2')],
    relationships: [{ source: 'a', target: 'c', type: 'ASSOCIATION', line: 1 }],
    packages: [{ name: 'p1', typeIds: ['a', 'b'] }, { name: 'p2', typeIds: ['c'] }],
    summaryMode: false,
    issues: [],
  };
}

function layout(): LayoutResult {
  return {
    nodes: [{ id: 'a', x: 0, y: 0, w: 100, h: 60 }, { id: 'b', x: 140, y: 0, w: 100, h: 60 }, { id: 'c', x: 0, y: 300, w: 100, h: 60 }],
    edges: [{ source: 'a', target: 'c', type: 'ASSOCIATION', points: [50, 60, 50, 300] }],
    packages: [{ name: 'p1', x: -18, y: -40, w: 276, h: 118 }, { name: 'p2', x: -18, y: 260, w: 136, h: 118 }],
    bounds: { x: -18, y: -40, w: 276, h: 418 },
  };
}

describe('overrides', () => {
  it('serializa y lee de vuelta', () => {
    const o = emptyOverrides();
    o.nodes.a = { x: 5, y: 6, packageName: 'p2' };
    expect(parseOverrides(serializeOverrides(o))).toEqual(o);
  });

  it('ignora datos corruptos', () => {
    expect(parseOverrides('no json')).toEqual(emptyOverrides());
    expect(parseOverrides('{"version":2,"nodes":{}}')).toEqual(emptyOverrides());
    expect(parseOverrides('{"version":1,"nodes":{"a":{"x":"1","y":2}}}').nodes).toEqual({});
  });

  it('pruneOverrides descarta ids y paquetes inexistentes', () => {
    const o = emptyOverrides();
    o.nodes.a = { x: 1, y: 1, packageName: 'zzz' };
    o.nodes.ghost = { x: 1, y: 1 };
    expect(pruneOverrides(model(), o).nodes).toEqual({ a: { x: 1, y: 1 } });
  });

  it('applyOverrides mueve el nodo y su paquete lo envuelve', () => {
    const o = emptyOverrides();
    o.nodes.b = { x: 600, y: 0 };
    const l = applyOverrides(model(), layout(), o);
    const p1 = l.packages.find((p) => p.name === 'p1');
    expect(p1 && p1.x + p1.w).toBeGreaterThanOrEqual(700);
    expect(l.bounds.w).toBeGreaterThan(600);
  });

  it('diff + apply reproduce el layout final', () => {
    const m = model();
    const base = applyOverrides(m, layout(), emptyOverrides());
    const final = finalizeDrop(base, 'b', 20, 300, 'p2');
    const o = diffOverrides(m, base, final);
    expect(o.nodes.b?.packageName).toBe('p2');
    const again = applyOverrides(m, layout(), o);
    const b1 = final.nodes.find((n) => n.id === 'b');
    const b2 = again.nodes.find((n) => n.id === 'b');
    expect(b2?.x).toBeCloseTo(b1?.x ?? -1);
    expect(b2?.packageName).toBe('p2');
  });

  it('la firma cambia con el modelo', () => {
    const m2 = model();
    m2.types.push(type('d', 'p2'));
    expect(modelSignature(model())).toBe(modelSignature(model()));
    expect(modelSignature(m2)).not.toBe(modelSignature(model()));
  });
});
