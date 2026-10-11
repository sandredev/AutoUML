// tests/presentation/diagram/analysis/overlay.test.ts — capa de análisis sobre el dibujo (T9): marcas y calor.
import { describe, expect, it } from 'vitest';
import { analyzeDiagram } from '../../../../src/domain/analysis/analyze';
import { buildOverlay, HEAT_STEPS, heatBin, markOfEdge } from '../../../../src/presentation/diagram/analysis/overlay';
import { PACKAGE_NODE_PREFIX } from '../../../../src/presentation/diagram/layout/aggregate';
import type { EdgePath } from '../../../../src/presentation/diagram/types';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

const edge = (source: string, target: string, relIndex?: number): EdgePath => ({
  source, target, type: 'ASSOCIATION', points: [0, 0, 1, 1], ...(relIndex !== undefined ? { rel: relIndex } : {}),
});

describe('heatBin', () => {
  it('reparte [min, max] en HEAT_STEPS tramos iguales; el máximo cae en el último', () => {
    expect(HEAT_STEPS).toBe(5);
    expect(heatBin(0, 0, 10)).toBe(0);
    expect(heatBin(1.99, 0, 10)).toBe(0);
    expect(heatBin(2, 0, 10)).toBe(1);
    expect(heatBin(10, 0, 10)).toBe(4);
  });

  it('rango vacío (todos iguales): el primer tramo', () => {
    expect(heatBin(3, 3, 3)).toBe(0);
  });
});

describe('buildOverlay', () => {
  // A ⇄ B es un ciclo; C → A es una violación (capa inferior → superior).
  const m = diagram(
    [typeNode('A', { packageName: 'ui' }), typeNode('B', { packageName: 'ui' }), typeNode('C', { packageName: 'core' })],
    [rel('A', 'B'), rel('B', 'A'), rel('C', 'A'), rel('A', 'C')],
  );
  const a = analyzeDiagram(m, { layers: ['ui', 'core'] });

  it('marca las aristas de ciclos y de violaciones (el ciclo manda)', () => {
    const o = buildOverlay(a, 'none');
    expect(o.edgeMark('A', 'B')).toBe('cycle');
    expect(o.edgeMark('B', 'A')).toBe('cycle');
    // A → C → A también es un ciclo: manda sobre la violación C → A.
    expect(o.edgeMark('C', 'A')).toBe('cycle');
    const sinCiclo = analyzeDiagram(diagram(m.types, [rel('C', 'A')]), { layers: ['ui', 'core'] });
    expect(buildOverlay(sinCiclo, 'none').edgeMark('C', 'A')).toBe('violation');
    expect(buildOverlay(sinCiclo, 'none').edgeMark('A', 'C')).toBeNull();
  });

  it('sin métrica no hay calor; con métrica, cada tipo analizado tiene su tramo', () => {
    expect(buildOverlay(a, 'none').heat).toBeNull();
    const fanIn = buildOverlay(a, 'fanIn');
    // Ca: A = 2 (B, C), B = 1, C = 1.
    expect(fanIn.legend).toEqual({ metric: 'fanIn', min: 0, max: 2 });
    expect(fanIn.heat?.get('A')).toBe(4);
    expect(fanIn.heat?.get('B')).toBe(2);
  });

  it('la inestabilidad usa siempre la escala fija [0, 1]', () => {
    const o = buildOverlay(a, 'instability');
    expect(o.legend).toEqual({ metric: 'instability', min: 0, max: 1 });
  });
});

describe('markOfEdge', () => {
  const m = diagram(
    [typeNode('A', { packageName: 'p' }), typeNode('B', { packageName: 'q' })],
    [rel('A', 'B'), rel('B', 'A'), rel('A', 'B', { associationClass: 'X' })],
  );
  const o = buildOverlay(analyzeDiagram(m), 'none');

  it('usa el sentido de la relación del modelo aunque la arista del layout vaya al revés', () => {
    expect(markOfEdge(o, m, edge('B', 'A', 0))).toBe('cycle');
  });

  it('una violación (en un solo sentido) se marca aunque el layout invierta la arista', () => {
    const one = diagram([typeNode('A', { packageName: 'low' }), typeNode('B', { packageName: 'up' })], [rel('A', 'B')]);
    const ov = buildOverlay(analyzeDiagram(one, { layers: ['up', 'low'] }), 'none');
    expect(markOfEdge(ov, one, edge('B', 'A', 0))).toBe('violation');
    expect(markOfEdge(ov, one, edge('B', 'A'))).toBeNull(); // sin relación: se usa el sentido de la arista
  });

  it('la relación de una clase asociación no se marca', () => {
    expect(markOfEdge(o, m, edge('A', 'B', 2))).toBeNull();
  });

  it('aristas entre paquetes plegados: se marcan si los dos paquetes están en un ciclo de paquetes', () => {
    expect(markOfEdge(o, m, edge(PACKAGE_NODE_PREFIX + 'p', PACKAGE_NODE_PREFIX + 'q'))).toBe('cycle');
    expect(markOfEdge(o, m, edge(PACKAGE_NODE_PREFIX + 'p', 'B'))).toBeNull();
  });
});
