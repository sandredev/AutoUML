// tests/domain/analysis/coupling.test.ts — Ca / Ce / I por clase y métricas de Martin por paquete (T9).
import { describe, expect, it } from 'vitest';
import { classCoupling, packageMetrics, topCoupled } from '../../../src/domain/analysis/coupling';
import { buildDependencyGraph } from '../../../src/domain/analysis/graph';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

describe('classCoupling', () => {
  it('estrella saliente: el centro es inestable (Ce = 3, I = 1) y las hojas estables (I = 0)', () => {
    const m = diagram([typeNode('Hub'), typeNode('A'), typeNode('B'), typeNode('C')], [rel('Hub', 'A'), rel('Hub', 'B'), rel('Hub', 'C')]);
    const c = classCoupling(buildDependencyGraph(m));
    expect(c.get('Hub')).toEqual({ ca: 0, ce: 3, instability: 1 });
    expect(c.get('A')).toEqual({ ca: 1, ce: 0, instability: 0 });
  });

  it('estrella entrante: Ca = aferente = quién me usa', () => {
    const m = diagram([typeNode('Core'), typeNode('A'), typeNode('B')], [rel('A', 'Core'), rel('B', 'Core')]);
    expect(classCoupling(buildDependencyGraph(m)).get('Core')).toEqual({ ca: 2, ce: 0, instability: 0 });
  });

  it('nodo aislado: I = 0, nunca NaN', () => {
    const c = classCoupling(buildDependencyGraph(diagram([typeNode('Solo')])));
    expect(c.get('Solo')).toEqual({ ca: 0, ce: 0, instability: 0 });
  });

  it('dos aristas paralelas cuentan una vez', () => {
    const m = diagram([typeNode('A'), typeNode('B')], [rel('A', 'B'), rel('A', 'B', { type: 'DEPENDENCY' })]);
    const c = classCoupling(buildDependencyGraph(m));
    expect(c.get('A')?.ce).toBe(1);
    expect(c.get('B')?.ca).toBe(1);
  });

  it('mixto: I = Ce / (Ca + Ce)', () => {
    const m = diagram([typeNode('X'), typeNode('A'), typeNode('B'), typeNode('C')], [rel('A', 'X'), rel('X', 'B'), rel('X', 'C')]);
    expect(classCoupling(buildDependencyGraph(m)).get('X')?.instability).toBeCloseTo(2 / 3);
  });
});

describe('topCoupled', () => {
  it('las N más acopladas por Ca + Ce, empate por id, sin las de acoplamiento 0', () => {
    const m = diagram(
      ['A', 'B', 'C', 'D', 'Z'].map((id) => typeNode(id)),
      [rel('A', 'B'), rel('A', 'C'), rel('B', 'C'), rel('D', 'C')],
    );
    const top = topCoupled(classCoupling(buildDependencyGraph(m)), 3);
    expect(top.map((t) => [t.id, t.ca + t.ce])).toEqual([['C', 3], ['A', 2], ['B', 2]]);
    expect(topCoupled(classCoupling(buildDependencyGraph(m)), 10).some((t) => t.id === 'Z')).toBe(false);
  });
});

describe('packageMetrics', () => {
  it('Ca / Ce cuentan CLASES (no relaciones); A = abstractas / total; D = |A + I − 1|', () => {
    const m = diagram(
      [
        typeNode('IRepo', { packageName: 'domain', declaredKind: 'interface', category: 'interface' }),
        typeNode('Entity', { packageName: 'domain' }),
        typeNode('Svc', { packageName: 'app' }),
        typeNode('Ctl', { packageName: 'app' }),
        typeNode('Repo', { packageName: 'infra' }),
      ],
      [rel('Svc', 'IRepo'), rel('Svc', 'Entity'), rel('Ctl', 'IRepo'), rel('Repo', 'IRepo', { type: 'IMPLEMENTS' }), rel('Ctl', 'Svc')],
    );
    const byName = new Map(packageMetrics(m, buildDependencyGraph(m)).map((p) => [p.name, p]));
    const domain = byName.get('domain');
    expect(domain).toMatchObject({ types: 2, abstractTypes: 1, ca: 3, ce: 0, instability: 0, abstractness: 0.5 });
    expect(domain?.distance).toBeCloseTo(0.5);
    // Svc y Ctl dependen de fuera; la arista interna Ctl → Svc no cuenta.
    expect(byName.get('app')).toMatchObject({ ca: 0, ce: 2, instability: 1, abstractness: 0, distance: 0 });
  });

  it('paquetes ordenados por nombre; uno aislado tiene I = 0', () => {
    const m = diagram([typeNode('B1', { packageName: 'b' }), typeNode('A1', { packageName: 'a' })]);
    const pk = packageMetrics(m, buildDependencyGraph(m));
    expect(pk.map((p) => p.name)).toEqual(['a', 'b']);
    expect(pk[0]?.instability).toBe(0);
  });
});
