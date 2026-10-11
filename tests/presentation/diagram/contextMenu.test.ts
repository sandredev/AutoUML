// tests/presentation/diagram/contextMenu.test.ts — entradas del menú contextual del lienzo (T8).
import { describe, expect, it } from 'vitest';
import { contextMenuEntries, type MenuContext } from '../../../src/presentation/diagram/contextMenu';
import { DEFAULT_LABELS } from '../../../src/presentation/diagram/labels';

const ctx: MenuContext = { canGoToCode: true, hasRoute: false, inFocus: false, hasFilters: false };
const actions = (es: ReturnType<typeof contextMenuEntries>): string[] => es.map((e) => e.action);
const entry = (es: ReturnType<typeof contextMenuEntries>, a: string) => es.find((e) => e.action === a);

describe('contextMenuEntries', () => {
  it('tarjeta: enfocar, ruta, copiar, ir al código, ocultar y plegar su paquete', () => {
    const es = contextMenuEntries({ kind: 'node', id: 'A', name: 'A', packageName: 'app' }, ctx, DEFAULT_LABELS);
    expect(actions(es)).toEqual(['focus', 'route-from', 'copy-name', 'go-to-code', 'hide-node', 'collapse-package']);
    expect(entry(es, 'focus')?.shortcut).toBe('F');
    expect(entry(es, 'collapse-package')?.label).toContain('app');
  });

  it('tarjeta sin paquete: plegar deshabilitado; sin editor: ir al código deshabilitado', () => {
    const es = contextMenuEntries(
      { kind: 'node', id: 'A', name: 'A', packageName: '(default package)' },
      { ...ctx, canGoToCode: false },
      DEFAULT_LABELS,
    );
    expect(entry(es, 'collapse-package')?.disabled).toBe(true);
    expect(entry(es, 'go-to-code')?.disabled).toBe(true);
  });

  it('paquete plegado: desplegar en vez de plegar, ocultar paquete y sin ir al código', () => {
    const es = contextMenuEntries({ kind: 'package', id: 'p', name: 'app' }, ctx, DEFAULT_LABELS);
    expect(actions(es)).toEqual(['focus', 'route-from', 'copy-name', 'expand-package', 'hide-node']);
    expect(entry(es, 'hide-node')?.label).toBe(DEFAULT_LABELS.menuHidePackage);
  });

  it('arista: ir al código (si hay línea), copiar y ocultar ese tipo de relación', () => {
    const es = contextMenuEntries({ kind: 'edge', name: 'A → B', relType: 'DEPENDENCY', line: 7 }, ctx, DEFAULT_LABELS);
    expect(actions(es)).toEqual(['go-to-code', 'copy-name', 'hide-rel-type']);
    expect(entry(es, 'hide-rel-type')?.label).toContain(DEFAULT_LABELS.relTypes.DEPENDENCY);
    const agg = contextMenuEntries({ kind: 'edge', name: 'A → B', relType: 'DEPENDENCY', line: null }, ctx, DEFAULT_LABELS);
    expect(entry(agg, 'go-to-code')?.disabled).toBe(true);
  });

  it('fondo: encuadrar y, según el estado, quitar ruta, salir del foco y quitar filtros', () => {
    expect(actions(contextMenuEntries({ kind: 'background' }, ctx, DEFAULT_LABELS))).toEqual(['fit']);
    const all = contextMenuEntries({ kind: 'background' }, { ...ctx, hasRoute: true, inFocus: true, hasFilters: true }, DEFAULT_LABELS);
    expect(actions(all)).toEqual(['fit', 'clear-route', 'exit-focus', 'clear-filters']);
    expect(entry(all, 'exit-focus')?.shortcut).toBe('Esc');
  });
});
