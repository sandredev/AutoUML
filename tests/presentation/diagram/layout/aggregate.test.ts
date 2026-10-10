import { describe, expect, it } from 'vitest';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';
import { aggregateCollapsed, collapsedKey, PACKAGE_NODE_PREFIX } from '../../../../src/presentation/diagram/layout/aggregate';
import { computeElkLayout } from '../../../../src/presentation/diagram/layout/elkLayout';
import { computeLayout, measureNode } from '../../../../src/presentation/diagram/layout/layout';

const P = (name: string): string => PACKAGE_NODE_PREFIX + name;

function model() {
  return diagram(
    [
      typeNode('A1', { packageName: 'app' }),
      typeNode('A2', { packageName: 'app' }),
      typeNode('D1', { packageName: 'domain' }),
      typeNode('D2', { packageName: 'domain.sub' }),
      typeNode('X'),
    ],
    [
      rel('A1', 'D1', { sourceLabel: '1', targetLabel: '*' }),
      rel('A2', 'D1'),
      rel('A1', 'D2'),
      rel('A1', 'A2'),
      rel('X', 'A1', { type: 'DEPENDENCY' }),
      rel('X', 'A2', { type: 'EXTENDS' }),
    ],
    { notes: [{ id: 'n', text: 'nota', anchor: 'A2', line: 3 }] },
  );
}

describe('aggregateCollapsed (T4)', () => {
  it('sin paquetes plegados devuelve el mismo modelo', () => {
    const m = model();
    expect(aggregateCollapsed(m, new Set()).model).toBe(m);
  });

  it('sustituye los tipos por un nodo de paquete COMPLETO y cuenta las entidades', () => {
    const { model: out, counts } = aggregateCollapsed(model(), new Set(['app']));
    expect(counts.get('app')).toBe(2);
    const pkg = out.types.find((t) => t.id === P('app'));
    expect(pkg).toMatchObject({ name: 'app', declaredKind: 'class', stereotypes: [], attributes: [], methods: [] });
    expect(out.types.map((t) => t.id)).not.toContain('A1');
    expect(out.packages.map((p) => p.name)).not.toContain('app');
    // El nodo sintético se puede medir (antes rompía measureNode por faltar campos).
    const size = measureNode(pkg!, false);
    expect(size.w).toBeGreaterThanOrEqual(190);
    expect(size.h).toBe(48);
  });

  it('agrega aristas iguales con "×n", quita las internas y conserva las de tipo distinto', () => {
    const { model: out } = aggregateCollapsed(model(), new Set(['app']));
    const toD1 = out.relationships.filter((r) => r.source === P('app') && r.target === 'D1');
    expect(toD1).toHaveLength(1);
    expect(toD1[0]?.label).toBe('×2');
    expect(toD1[0]?.sourceLabel).toBeUndefined();
    expect(out.relationships.some((r) => r.source === P('app') && r.target === P('app'))).toBe(false);
    const fromX = out.relationships.filter((r) => r.source === 'X');
    expect(fromX.map((r) => r.type).sort()).toEqual(['DEPENDENCY', 'EXTENDS']);
    expect(fromX.every((r) => r.label === undefined)).toBe(true);
  });

  it('un paquete plegado incluye sus subpaquetes por nombre completo', () => {
    const { model: out, counts } = aggregateCollapsed(model(), new Set(['domain']));
    expect(counts.get('domain')).toBe(2);
    expect(out.packages.map((p) => p.name).sort()).toEqual(['(default package)', 'app']);
  });

  it('las notas ancladas a un tipo plegado apuntan al nodo del paquete', () => {
    const { model: out } = aggregateCollapsed(model(), new Set(['app']));
    expect(out.notes?.[0]?.anchor).toBe(P('app'));
  });

  it('collapsedKey no depende del orden', () => {
    expect(collapsedKey(new Set(['b', 'a']))).toBe(collapsedKey(new Set(['a', 'b'])));
  });

  it('dagre y ELK colocan el paquete plegado como un único nodo con sus aristas', async () => {
    const { model: out } = aggregateCollapsed(model(), new Set(['app']));
    for (const r of [computeLayout(out), await computeElkLayout(out)]) {
      const node = r.nodes.find((n) => n.id === P('app'));
      expect(node?.h).toBe(48);
      expect(node?.label).toBe('app');
      expect(r.edges.some((e) => e.source === P('app') && e.target === 'D1')).toBe(true);
      expect(r.edges.every((e) => e.points.every(Number.isFinite))).toBe(true);
    }
  });
});
