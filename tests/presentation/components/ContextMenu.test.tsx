// tests/presentation/components/ContextMenu.test.tsx — menú contextual accesible (T8).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { clampMenuPosition, ContextMenu, nextEnabledIndex } from '../../../src/presentation/components/ContextMenu';

describe('clampMenuPosition', () => {
  it('cabe: se queda en el punto', () => {
    expect(clampMenuPosition(100, 100, 200, 150, 1000, 800)).toEqual({ left: 100, top: 100 });
  });

  it('se saldría por la derecha o por abajo: se abre hacia el otro lado', () => {
    expect(clampMenuPosition(900, 700, 200, 150, 1000, 800)).toEqual({ left: 700, top: 550 });
  });

  it('nunca queda fuera por arriba/izquierda aunque el menú sea más grande que la ventana', () => {
    expect(clampMenuPosition(50, 50, 400, 900, 300, 600)).toEqual({ left: 4, top: 4 });
  });
});

describe('nextEnabledIndex', () => {
  const disabled = [false, true, false, false];

  it('flechas: salta los deshabilitados y da la vuelta', () => {
    expect(nextEnabledIndex(disabled, 0, 'ArrowDown')).toBe(2);
    expect(nextEnabledIndex(disabled, 3, 'ArrowDown')).toBe(0);
    expect(nextEnabledIndex(disabled, 2, 'ArrowUp')).toBe(0);
    expect(nextEnabledIndex(disabled, 0, 'ArrowUp')).toBe(3);
  });

  it('Inicio/Fin: primero y último habilitados', () => {
    expect(nextEnabledIndex([true, false, false, true], 2, 'Home')).toBe(1);
    expect(nextEnabledIndex([true, false, false, true], 1, 'End')).toBe(2);
  });

  it('sin habilitados u otra tecla: -1 / el mismo', () => {
    expect(nextEnabledIndex([true, true], 0, 'ArrowDown')).toBe(-1);
    expect(nextEnabledIndex(disabled, 2, 'x')).toBe(2);
  });
});

describe('ContextMenu', () => {
  it('role=menu con menuitems; los deshabilitados lo anuncian; atajos con aria-keyshortcuts', () => {
    const html = renderToStaticMarkup(
      <ContextMenu
        x={10}
        y={20}
        label="Acciones"
        items={[
          { id: 'a', label: 'Enfocar', shortcut: 'F' },
          { id: 'b', label: 'Ir al código', disabled: true },
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Acciones"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-keyshortcuts="F"');
  });
});
