// tests/presentation/diagram/routing/routeQuality.test.ts — calidad del ruteo en reposo: sin tramos dentro de
// tarjetas tras mover a mano, rectas entre tarjetas casi pegadas y reparto de líneas en los pasillos.
import { describe, expect, it } from 'vitest';
import { applyOverrides, setOverride, EMPTY_OVERRIDES, type Overrides } from '../../../../src/presentation/diagram/canvas/overrides';
import { nudgeEdges, routeAllEdges } from '../../../../src/presentation/diagram/routing';
import type { EdgePath, LayoutResult, NodeBox } from '../../../../src/presentation/diagram/types';

/** Tramos de una arista que entran en el interior de una tarjeta (margen 1px), incluidas las suyas. */
function segmentsInsideCards(e: EdgePath, nodes: readonly NodeBox[]): number {
  let hits = 0;
  const p = e.points;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x0 = Math.min(p[i]!, p[i + 2]!), x1 = Math.max(p[i]!, p[i + 2]!);
    const y0 = Math.min(p[i + 1]!, p[i + 3]!), y1 = Math.max(p[i + 1]!, p[i + 3]!);
    for (const n of nodes) {
      if (x1 > n.x + 1 && x0 < n.x + n.w - 1 && y1 > n.y + 1 && y0 < n.y + n.h - 1) hits++;
    }
  }
  return hits;
}

function edge(source: string, target: string, rel: number): EdgePath {
  return { source, target, type: 'ASSOCIATION', points: [], routing: 'orthogonal', rel };
}

describe('ruteo en reposo (applyOverrides settled)', () => {
  // Fila de tres tarjetas; A→C pasa por encima de B. Después se mueve B justo encima de la ruta y C debajo.
  const nodes: NodeBox[] = [
    { id: 'A', x: 0, y: 0, w: 100, h: 60 },
    { id: 'B', x: 200, y: 0, w: 100, h: 60 },
    { id: 'C', x: 400, y: 0, w: 100, h: 60 },
    { id: 'D', x: 200, y: 200, w: 100, h: 60 },
  ];
  const baseEdges = [edge('A', 'C', 0), edge('D', 'A', 1), edge('C', 'D', 2)];
  const base: LayoutResult = {
    nodes,
    packages: [],
    edges: routeAllEdges(nodes, [], baseEdges),
    bounds: { x: 0, y: 0, w: 500, h: 260 },
  };
  let ov: Overrides = setOverride(EMPTY_OVERRIDES, 'D', { dx: -180, dy: -100 });
  ov = setOverride(ov, 'C', { dx: -100, dy: 180 });

  it('tras mover varias tarjetas ninguna arista atraviesa una tarjeta', () => {
    const settled = applyOverrides(base, ov, { settled: true });
    for (const e of settled.edges) expect(segmentsInsideCards(e, settled.nodes)).toBe(0);
  });

  it('sin settled se conserva el reruteo incremental (más barato, para el arrastre)', () => {
    const dragging = applyOverrides(base, ov);
    const settled = applyOverrides(base, ov, { settled: true });
    expect(dragging.nodes).toEqual(settled.nodes);
    expect(dragging.edges).toHaveLength(settled.edges.length);
  });
});

describe('tarjetas casi pegadas', () => {
  it('caras enfrentadas a 3px: recta corta, sin ganchos por dentro de las tarjetas', () => {
    const nodes: NodeBox[] = [
      { id: 'Farm', x: 0, y: 0, w: 270, h: 156 },
      { id: 'Zone', x: 273, y: 25, w: 334, h: 138 },
    ];
    const [e] = routeAllEdges(nodes, [], [edge('Farm', 'Zone', 0)]);
    expect(e).toBeDefined();
    if (!e) return;
    expect(segmentsInsideCards(e, nodes)).toBe(0);
    expect(e.points).toHaveLength(4); // un solo tramo
    expect(e.points[0]).toBe(270);
    expect(e.points[2]).toBe(273);
  });
});

describe('nudgeEdges', () => {
  // Pasillo vertical de 40px entre dos columnas de tarjetas.
  const nodes: NodeBox[] = [
    { id: 'L', x: 0, y: 0, w: 100, h: 300 },
    { id: 'R', x: 140, y: 0, w: 100, h: 300 },
    { id: 'T', x: 60, y: -200, w: 120, h: 60 },
    { id: 'S', x: 60, y: 440, w: 120, h: 60 },
  ];

  it('un tramo pegado a una tarjeta en un pasillo estrecho queda centrado', () => {
    const e: EdgePath = { ...edge('T', 'S', 0), points: [110, -140, 110, -60, 102, -60, 102, 380, 110, 380, 110, 440] };
    const [out] = nudgeEdges([e], nodes, []);
    // El tramo largo (x=102, a 2px de L) pasa al centro del pasillo [100, 140].
    expect(out?.points[4]).toBe(120);
    expect(out?.points[6]).toBe(120);
    expect(segmentsInsideCards(out!, nodes)).toBe(0);
  });

  it('dos tramos casi superpuestos en el mismo pasillo se reparten sin cambiar su orden', () => {
    const a: EdgePath = { ...edge('T', 'S', 0), points: [100 + 10, -140, 110, -60, 118, -60, 118, 380, 110, 380, 110, 440] };
    const b: EdgePath = { ...edge('T', 'S', 1), points: [150, -140, 150, -60, 120, -60, 120, 380, 150, 380, 150, 440] };
    const [na, nb] = nudgeEdges([a, b], nodes, []);
    const xa = na?.points[4] ?? 0;
    const xb = nb?.points[4] ?? 0;
    expect(xb - xa).toBeGreaterThanOrEqual(10);
    expect(xa).toBeGreaterThan(100);
    expect(xb).toBeLessThan(140);
  });

  it('no toca bucles ni polilíneas', () => {
    const poly: EdgePath = { ...edge('L', 'R', 0), routing: 'polyline', points: [100, 10, 140, 50] };
    expect(nudgeEdges([poly], nodes, [])[0]).toBe(poly);
  });
});
