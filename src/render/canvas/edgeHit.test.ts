import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../types';
import { distToPolyline, distToSegment, hitTestEdge } from './edgeHit';
import { buildIndex } from './spatial';

const layout: LayoutResult = {
  nodes: [],
  edges: [
    { source: 'A', target: 'B', type: 'ASSOCIATION', points: [0, 0, 100, 0] },
    { source: 'A', target: 'C', type: 'DEPENDENCY', points: [0, 50, 0, 100, 100, 100] },
    { source: 'X', target: 'Y', type: 'EXTENDS', points: [5000, 5000, 5100, 5000] },
  ],
  packages: [],
  bounds: { x: 0, y: 0, w: 5100, h: 5000 },
};

describe('hit-test de aristas (T4)', () => {
  it('distancia a un segmento: perpendicular dentro y a los extremos fuera', () => {
    expect(distToSegment(50, 10, 0, 0, 100, 0)).toBeCloseTo(10);
    expect(distToSegment(-30, 40, 0, 0, 100, 0)).toBeCloseTo(50);
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  it('distancia a la polilínea = mínima de sus tramos', () => {
    expect(distToPolyline([0, 50, 0, 100, 100, 100], 50, 97)).toBeCloseTo(3);
  });

  it('acierta dentro de la tolerancia y falla fuera', () => {
    expect(hitTestEdge(layout, 50, 4, 6)).toBe(0);
    expect(hitTestEdge(layout, 50, 7, 6)).toBeNull();
    expect(hitTestEdge(layout, 60, 103, 6)).toBe(1);
  });

  it('la tolerancia en pantalla se convierte a mundo con la escala', () => {
    // 6 px a escala 0.5 ⇒ 12 unidades de mundo
    expect(hitTestEdge(layout, 50, 10, 6 / 0.5)).toBe(0);
    expect(hitTestEdge(layout, 50, 10, 6 / 2)).toBeNull();
  });

  it('con dos candidatas gana la más cercana', () => {
    expect(hitTestEdge(layout, 2, 48, 10)).toBe(1);
    expect(hitTestEdge(layout, 2, 2, 10)).toBe(0);
  });

  it('con el índice espacial da lo mismo que sin él', () => {
    const index = buildIndex(layout);
    for (const [x, y] of [[50, 4], [60, 103], [5050, 3], [300, 300]] as const) {
      expect(hitTestEdge(layout, x, y, 6, index)).toBe(hitTestEdge(layout, x, y, 6));
    }
  });
});
