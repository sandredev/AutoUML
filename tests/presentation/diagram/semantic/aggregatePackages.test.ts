// tests/presentation/diagram/semantic/aggregatePackages.test.ts — zoom semántico por paquetes (T10).
import { describe, expect, it } from 'vitest';
import type { EdgePath, LayoutResult, NodeBox, PackageBox } from '../../../../src/presentation/diagram/types';
import {
  aggregatePackages,
  blockAlpha,
  edgeWidth,
  SEMANTIC_HI,
  SEMANTIC_LO,
  semanticOf,
} from '../../../../src/presentation/diagram/semantic/aggregatePackages';

const node = (id: string, packageName?: string): NodeBox => ({ id, x: 0, y: 0, w: 10, h: 10, packageName });
const pkg = (name: string, x = 0): PackageBox => ({ name, x, y: 0, w: 100, h: 50 });
const edge = (source: string, target: string): EdgePath => ({ source, target, type: 'ASSOCIATION', points: [] });
const layout = (nodes: NodeBox[], packages: PackageBox[], edges: EdgePath[] = []): LayoutResult =>
  ({ nodes, edges, packages, bounds: { x: 0, y: 0, w: 1, h: 1 } });

describe('aggregatePackages', () => {
  it('cuenta clases por paquete y usa la caja del paquete como bounds', () => {
    const r = aggregatePackages(layout([node('A', 'a'), node('B', 'a'), node('C', 'b')], [pkg('a'), pkg('b', 200)]));
    expect(r.packages).toEqual([
      { name: 'a', classCount: 2, bounds: { x: 0, y: 0, w: 100, h: 50 } },
      { name: 'b', classCount: 1, bounds: { x: 200, y: 0, w: 100, h: 50 } },
    ]);
  });

  it('los subpaquetes se suman al paquete más externo', () => {
    const r = aggregatePackages(layout([node('A', 'a'), node('B', 'a.x'), node('C', 'a.x.y')], [pkg('a'), pkg('a.x')]));
    expect(r.packages).toEqual([{ name: 'a', classCount: 3, bounds: { x: 0, y: 0, w: 100, h: 50 } }]);
  });

  it('paquete sin clases → no aparece; clases sin paquete → sueltas', () => {
    const r = aggregatePackages(layout([node('A', 'a'), node('L'), node('M', '')], [pkg('a'), pkg('vacio')]));
    expect(r.packages.map((p) => p.name)).toEqual(['a']);
    expect(r.loose).toEqual(['L', 'M']);
  });

  it('fusiona aristas entre paquetes con n y descarta las internas', () => {
    const r = aggregatePackages(layout(
      [node('A', 'a'), node('B', 'a'), node('C', 'b'), node('D', 'b.z')],
      [pkg('a'), pkg('b')],
      [edge('A', 'C'), edge('B', 'D'), edge('A', 'B'), edge('C', 'A'), edge('A', 'C')],
    ));
    expect(r.edges.map(({ source, target, n }) => ({ source, target, n }))).toEqual([
      { source: 'a', target: 'b', n: 3 },
      { source: 'b', target: 'a', n: 1 },
    ]);
    expect(r.edges[0].width).toBe(edgeWidth(3));
  });

  it('aristas con un extremo suelto o desconocido no se agregan', () => {
    const r = aggregatePackages(layout([node('A', 'a'), node('L')], [pkg('a')], [edge('A', 'L'), edge('A', '??')]));
    expect(r.edges).toEqual([]);
  });

  it('owners: cada clase con paquete apunta a su bloque; las sueltas no aparecen', () => {
    const r = aggregatePackages(layout([node('A', 'a.x'), node('B', 'b'), node('L')], [pkg('a'), pkg('b')]));
    expect([...r.owners]).toEqual([['A', 'a'], ['B', 'b']]);
  });

  it('orden determinista', () => {
    const l = layout([node('A', 'z'), node('B', 'a')], [pkg('z'), pkg('a')], [edge('A', 'B'), edge('B', 'A')]);
    const r = aggregatePackages(l);
    expect(r.packages.map((p) => p.name)).toEqual(['a', 'z']);
    expect(r.edges.map((e) => e.source)).toEqual(['a', 'z']);
  });
});

describe('semanticOf (memo por layout)', () => {
  it('mismo layout → misma agregación; otro layout → otra', () => {
    const l = layout([node('A', 'a')], [pkg('a')]);
    const first = semanticOf(l);
    expect(semanticOf(l)).toBe(first);
    expect(first).toEqual(aggregatePackages(l));
    expect(semanticOf(layout([node('A', 'a')], [pkg('a')]))).not.toBe(first);
  });
});

describe('edgeWidth', () => {
  it('crece con n y está acotado', () => {
    expect(edgeWidth(1)).toBeGreaterThan(0);
    for (let n = 1; n < 200; n++) expect(edgeWidth(n + 1)).toBeGreaterThanOrEqual(edgeWidth(n));
    expect(edgeWidth(2)).toBeGreaterThan(edgeWidth(1));
    expect(edgeWidth(1e6)).toBeLessThanOrEqual(10);
  });
});

describe('blockAlpha', () => {
  it('1 lejos, 0 cerca, interpolación suave y monótona en medio', () => {
    expect(blockAlpha(SEMANTIC_LO / 2)).toBe(1);
    expect(blockAlpha(SEMANTIC_LO)).toBe(1);
    expect(blockAlpha(SEMANTIC_HI)).toBe(0);
    expect(blockAlpha(SEMANTIC_HI * 2)).toBe(0);
    const mid = blockAlpha((SEMANTIC_LO + SEMANTIC_HI) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    let prev = 1;
    for (let s = SEMANTIC_LO; s <= SEMANTIC_HI; s += (SEMANTIC_HI - SEMANTIC_LO) / 20) {
      expect(blockAlpha(s)).toBeLessThanOrEqual(prev);
      prev = blockAlpha(s);
    }
  });
});

describe('rendimiento (1000 nodos / 2000 aristas)', () => {
  it('agrega en < 50 ms', () => {
    let seed = 42;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const nodes = Array.from({ length: 1000 }, (_, i) => node('T' + i, 'p' + (i % 20) + (i % 3 ? '.sub' : '')));
    const packages = Array.from({ length: 20 }, (_, i) => pkg('p' + i, i * 120));
    const edges = Array.from({ length: 2000 }, () => edge('T' + Math.floor(rnd() * 1000), 'T' + Math.floor(rnd() * 1000)));
    const l = layout(nodes, packages, edges);
    const t0 = performance.now();
    const r = aggregatePackages(l);
    const ms = performance.now() - t0;
    expect(r.packages).toHaveLength(20);
    expect(r.packages.reduce((s, p) => s + p.classCount, 0)).toBe(1000);
    expect(ms).toBeLessThan(50);
  });
});
