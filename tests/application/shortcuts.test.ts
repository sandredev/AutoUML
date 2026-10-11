// tests/application/shortcuts.test.ts — mapa único de atajos anunciados (#39).
import type { MenuState } from '../../src/application/ports/ipc';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, acceleratorOf, actionOfShortcut, isShortcutEnabled, keysOf, matchShortcut, type ShortcutId } from '../../src/application/shortcuts';

const press = (key: string, mods: { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean } = {}) => ({
  key,
  ctrlKey: mods.ctrl ?? true,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe('mapa de atajos', () => {
  it('no hay dos entradas con la misma combinación', () => {
    const keys = Object.values(SHORTCUTS).map((s) => s.keys.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('el texto anunciado y el acelerador nativo salen de la misma entrada', () => {
    expect(keysOf('zoomIn')).toBe('Ctrl+=');
    expect(acceleratorOf('zoomIn')).toBe('CmdOrCtrl+=');
    expect(keysOf('openProject')).toBe('Ctrl+Shift+O');
    expect(acceleratorOf('openProject')).toBe('CmdOrCtrl+Shift+O');
  });
});

describe('matchShortcut (despacho global del renderer)', () => {
  const cases: [string, ReturnType<typeof press>, ShortcutId][] = [
    ['Ctrl+N', press('n'), 'newProject'],
    ['Ctrl+Shift+O', press('O', { shift: true }), 'openProject'],
    ['Ctrl+O', press('o'), 'loadPuml'],
    ['Ctrl+R', press('r'), 'reload'],
    ['Ctrl+S', press('s'), 'save'],
    ['Ctrl+Shift+E', press('E', { shift: true }), 'exportSvg'],
    ['Ctrl+Shift+P', press('P', { shift: true }), 'exportPdf'],
    ['Ctrl+Shift+C', press('C', { shift: true }), 'copyPng'],
    ['Ctrl+=', press('='), 'zoomIn'],
    ['Ctrl++ (Mayús+=)', press('+', { shift: true }), 'zoomIn'],
    ['Ctrl+-', press('-'), 'zoomOut'],
    ['Ctrl+0', press('0'), 'fit'],
    ['Ctrl+B', press('b'), 'toggleSidebar'],
    ['Ctrl+E', press('e'), 'toggleEditor'],
    ['Ctrl+,', press(','), 'settings'],
    ['Ctrl+Shift+L', press('L', { shift: true }), 'relayout'],
    ['F11 (pantalla completa, sin Ctrl)', press('F11', { ctrl: false }), 'fullscreen'],
    ['Cmd+B (macOS)', press('b', { ctrl: false, meta: true }), 'toggleSidebar'],
  ];
  it.each(cases)('%s', (_name, e, id) => {
    expect(matchShortcut(e)).toBe(id);
  });

  it('sin Ctrl/Cmd, con Alt o con una tecla sin atajo no despacha nada', () => {
    expect(matchShortcut(press('b', { ctrl: false }))).toBeNull();
    expect(matchShortcut(press('b', { alt: true }))).toBeNull();
    expect(matchShortcut(press('q'))).toBeNull();
  });

  it('Ctrl+0 solo encuadra: pantalla completa no cuelga de él', () => {
    expect(matchShortcut(press('0'))).toBe('fit');
    expect(keysOf('fullscreen')).toBe('F11');
    expect(matchShortcut(press('F11'))).toBeNull();
  });

  it('Ctrl+K es del visor (paleta): no lo despacha el renderer global', () => {
    expect(matchShortcut(press('k'))).toBeNull();
  });
});

describe('actionOfShortcut', () => {
  it('traduce la entrada a la acción de menú que ya entiende App', () => {
    expect(actionOfShortcut('zoomIn')).toBe('zoom-in');
    expect(actionOfShortcut('toggleSidebar')).toBe('toggle-sidebar');
    expect(actionOfShortcut('settings')).toBe('settings-more');
  });

  it('relayout no es acción de menú', () => {
    expect(actionOfShortcut('relayout')).toBeNull();
  });
});

describe('isShortcutEnabled (mismo criterio que las opciones del menú)', () => {
  const base: MenuState = { projectOpen: false, hasPuml: false, sidebarVisible: true, editorVisible: false, dirty: false, locale: 'es', themeMode: 'system' } as MenuState;

  it('sin nada abierto solo valen los de proyecto nuevo/abrir y ajustes', () => {
    expect(isShortcutEnabled('newProject', base)).toBe(true);
    expect(isShortcutEnabled('settings', base)).toBe(true);
    expect(isShortcutEnabled('zoomIn', base)).toBe(false);
    expect(isShortcutEnabled('loadPuml', base)).toBe(false);
    expect(isShortcutEnabled('toggleSidebar', base)).toBe(false);
    expect(isShortcutEnabled('fullscreen', base)).toBe(false);
  });

  it('con un diagrama externo (sin proyecto) valen vista y exportar, no cargar', () => {
    const s = { ...base, hasPuml: true };
    expect(isShortcutEnabled('fit', s)).toBe(true);
    expect(isShortcutEnabled('copyPng', s)).toBe(true);
    expect(isShortcutEnabled('toggleSidebar', s)).toBe(true);
    expect(isShortcutEnabled('loadPuml', s)).toBe(false);
  });

  it('guardar exige cambios sin guardar', () => {
    const s = { ...base, projectOpen: true, hasPuml: true };
    expect(isShortcutEnabled('save', s)).toBe(false);
    expect(isShortcutEnabled('save', { ...s, dirty: true })).toBe(true);
  });
});
