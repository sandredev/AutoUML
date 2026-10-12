// tests/presentation/diagram/FiltersPanel.test.tsx — panel de filtros del visor (T8).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FiltersPanel, withListItem } from '../../../src/presentation/diagram/FiltersPanel';
import { DEFAULT_LABELS } from '../../../src/presentation/diagram/labels';

const render = (props: Partial<Parameters<typeof FiltersPanel>[0]> = {}): string =>
  renderToStaticMarkup(
    <FiltersPanel filters={{}} packages={['app', 'core']} labels={DEFAULT_LABELS} onChange={vi.fn()} {...props} />,
  );

describe('withListItem', () => {
  it('añade o quita sin duplicar y sin mutar', () => {
    const list = ['a'];
    expect(withListItem(list, 'b', true)).toEqual(['a', 'b']);
    expect(withListItem(list, 'a', true)).toBe(list);
    expect(withListItem(list, 'a', false)).toEqual([]);
    expect(withListItem(undefined, 'a', false)).toEqual([]);
    expect(list).toEqual(['a']);
  });
});

describe('FiltersPanel', () => {
  it('cerrado: solo el botón, con aria-expanded=false', () => {
    const html = render();
    expect(html).toContain(DEFAULT_LABELS.filters);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(DEFAULT_LABELS.filtersRelations);
  });

  it('con filtros activos el botón lo indica', () => {
    const html = render({ filters: { hideExternal: true, hiddenRelTypes: ['DEPENDENCY'] } });
    expect(html).toContain(DEFAULT_LABELS.filtersActive.replace('{n}', '2'));
  });

  it('abierto: secciones, casillas que reflejan los filtros y un paquete por casilla', () => {
    const html = render({ defaultOpen: true, filters: { hiddenRelTypes: ['DEPENDENCY'], hideAccessors: true, hiddenPackages: ['core'] } });
    expect(html).toContain('aria-expanded="true"');
    for (const k of ['filtersRelations', 'filtersMembers', 'filtersClasses', 'filtersPackages'] as const) expect(html).toContain(DEFAULT_LABELS[k]);
    expect(html).toContain(DEFAULT_LABELS.relTypes.DEPENDENCY);
    expect(html).toContain('app');
    expect(html).toContain('core');
    // 6 tipos de relación + 2 paquetes visibles (relaciones visibles: 5; paquetes marcados: app) + accesores.
    const checked = html.match(/checked=""/g)?.length ?? 0;
    expect(checked).toBe(5 + 1 + 1);
  });

  it('las clases ocultadas a mano se cuentan y se pueden mostrar', () => {
    const html = render({ defaultOpen: true, filters: { hiddenTypes: ['A', 'B'] } });
    expect(html).toContain(DEFAULT_LABELS.filtersHiddenTypes.replace('{n}', '2'));
    expect(html).toContain(DEFAULT_LABELS.filtersShowTypes);
  });

  it('abierto: el panel va anclado a la izquierda (no lo recorta el lienzo)', () => {
    const html = render({ defaultOpen: true });
    expect(html).toContain('class="filters-panel align-start"');
  });
});
