// tests/presentation/diagram/palette/actions.test.ts — acciones de la paleta de comandos (T10.2).
import { describe, expect, it, vi } from 'vitest';
import type { ViewerLabels } from '../../../../src/presentation/diagram/labels';
import {
  buildPaletteActions,
  type PaletteActionsInput,
} from '../../../../src/presentation/diagram/palette/actions';
import { fuzzySearch } from '../../../../src/presentation/diagram/palette/fuzzy';

const viewerLabels = {
  menuFocus: 'Enfocar',
  menuRouteFrom: 'Ruta desde aquí',
  menuCopyName: 'Copiar nombre',
  menuGoToCode: 'Ir al código',
  menuHideClass: 'Ocultar clase',
  menuCollapsePackage: 'Plegar {name}',
  noPackage: '(sin paquete)',
} as unknown as ViewerLabels;

function setup(over: Partial<PaletteActionsInput> = {}) {
  const host = {
    app: vi.fn(),
    context: vi.fn(),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
    clearFilters: vi.fn(),
    theme: vi.fn(),
  };
  const input: PaletteActionsInput = {
    labels: {
      exportPng: 'Exportar PNG',
      exportSvg: 'Exportar SVG',
      exportPdf: 'Exportar PDF',
      copyPng: 'Copiar PNG',
      collapseAll: 'Plegar todos los paquetes',
      expandAll: 'Desplegar todos los paquetes',
      clearFilters: 'Quitar filtros',
      theme: 'Tema: {name}',
    },
    viewerLabels,
    themes: [
      { mode: 'dark', name: 'Oscuro' },
      { mode: 'light', name: 'Claro' },
    ],
    hasDocument: true,
    packageCount: 3,
    collapsedCount: 0,
    hasFilters: false,
    focused: null,
    menuContext: { canGoToCode: true, hasRoute: false, inFocus: false, hasFilters: false },
    host,
    ...over,
  };
  const actions = buildPaletteActions(input);
  const byLabel = (label: string) => actions.find((a) => a.label === label);
  return { actions, host, byLabel };
}

describe('acciones de la app', () => {
  it('exportar solo está habilitado con un documento y ejecuta la acción de menú', () => {
    const on = setup();
    on.byLabel('Exportar SVG')!.run();
    expect(on.byLabel('Exportar SVG')!.enabled).toBe(true);
    expect(on.host.app).toHaveBeenCalledWith('export-svg');

    const off = setup({ hasDocument: false });
    for (const l of ['Exportar PNG', 'Exportar SVG', 'Exportar PDF', 'Copiar PNG']) {
      expect(off.byLabel(l)!.enabled).toBe(false);
    }
  });

  it('plegar/desplegar todo se habilitan según haya paquetes y plegados', () => {
    const a = setup({ packageCount: 3, collapsedCount: 0 });
    expect(a.byLabel('Plegar todos los paquetes')!.enabled).toBe(true);
    expect(a.byLabel('Desplegar todos los paquetes')!.enabled).toBe(false);

    const b = setup({ packageCount: 3, collapsedCount: 3 });
    expect(b.byLabel('Plegar todos los paquetes')!.enabled).toBe(false);
    b.byLabel('Desplegar todos los paquetes')!.run();
    expect(b.host.expandAll).toHaveBeenCalledOnce();
  });

  it('quitar filtros solo se habilita con filtros activos', () => {
    expect(setup().byLabel('Quitar filtros')!.enabled).toBe(false);
    const s = setup({ hasFilters: true });
    s.byLabel('Quitar filtros')!.run();
    expect(s.host.clearFilters).toHaveBeenCalledOnce();
  });

  it('una acción por tema, con el nombre interpolado', () => {
    const s = setup();
    s.byLabel('Tema: Claro')!.run();
    expect(s.host.theme).toHaveBeenCalledWith('light');
    expect(s.byLabel('Tema: Oscuro')).toBeDefined();
  });
});

describe('acciones contextuales sobre la clase enfocada', () => {
  const node = { kind: 'node', id: 'a.User', name: 'User', packageName: 'a' } as const;

  it('no hay acciones contextuales sin clase enfocada', () => {
    const { byLabel } = setup({ focused: null });
    expect(byLabel('Copiar nombre')).toBeUndefined();
    expect(byLabel('Ocultar clase')).toBeUndefined();
  });

  it('con clase enfocada se aplican a ella y muestran su nombre como detalle', () => {
    const s = setup({ focused: node });
    const copy = s.byLabel('Copiar nombre')!;
    expect(copy.detail).toBe('User');
    copy.run();
    expect(s.host.context).toHaveBeenCalledWith('copy-name', node);
  });

  it('respeta las entradas deshabilitadas del menú contextual', () => {
    const s = setup({ focused: node, menuContext: { canGoToCode: false, hasRoute: false, inFocus: false, hasFilters: false } });
    expect(s.byLabel('Ir al código')!.enabled).toBe(false);
    expect(s.byLabel('Enfocar')!.enabled).toBe(true);
  });
});

describe('búsqueda difusa sobre acciones', () => {
  it('encuentra y resalta acciones por su etiqueta', () => {
    const { actions } = setup();
    const r = fuzzySearch('expsvg', actions);
    expect(r[0]?.item.label).toBe('Exportar SVG');
    expect(r[0]?.indices.length).toBe(6);
  });
});
