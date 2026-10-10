import { describe, expect, it } from 'vitest';
import type { LayoutResult, NodeBox } from '../../../../src/presentation/diagram/types';
import { buildIndex, hitTestNode, queryNodes } from '../../../../src/presentation/diagram/canvas/spatial';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLayout(n: number): LayoutResult {
  const r = rng(11);
  const nodes: NodeBox[] = Array.from({ length: n }, (_, i) => ({
    id: `N${i}`, x: r() * 20000, y: r() * 20000, w: 100 + r() * 100, h: 40 + r() * 80,
  }));
  return { nodes, edges: [], packages: [], bounds: { x: 0, y: 0, w: 20200, h: 20120 } };
}

describe('spatial', () => {
  it('queryNodes coincide con la búsqueda por fuerza bruta', () => {
    const L = randomLayout(1000);
    const ix = buildIndex(L);
    const r = rng(5);
    for (let k = 0; k < 30; k++) {
      const rect = { x: r() * 20000 - 500, y: r() * 20000 - 500, w: r() * 3000, h: r() * 3000 };
      const got = queryNodes(ix, rect);
      const want: number[] = [];
      L.nodes.forEach((b, i) => {
        if (b.x <= rect.x + rect.w && b.x + b.w >= rect.x && b.y <= rect.y + rect.h && b.y + b.h >= rect.y) want.push(i);
      });
      expect(got).toEqual(want);
    }
  });

  it('hitTestNode acierta y falla', () => {
    const L: LayoutResult = {
      nodes: [{ id: 'A', x: 0, y: 0, w: 100, h: 50 }, { id: 'B', x: 300, y: 300, w: 100, h: 50 }],
      edges: [], packages: [], bounds: { x: 0, y: 0, w: 400, h: 350 },
    };
    const ix = buildIndex(L);
    expect(hitTestNode(ix, L, 50, 25)).toBe('A');
    expect(hitTestNode(ix, L, 350, 325)).toBe('B');
    expect(hitTestNode(ix, L, 200, 200)).toBeNull();
  });
});
