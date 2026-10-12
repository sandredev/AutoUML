import { describe, expect, it } from 'vitest';
import { parseThemeMode, resolveThemeId, themeSwatches } from '../../../src/presentation/components/useTheme';
import { THEME_IDS, THEME_MODES, THEME_SCHEME, isThemeMode, migrateThemeMode } from '../../../src/domain/rules/themes';

describe('useTheme helpers', () => {
  it('acepta solo modos conocidos y cae a system', () => {
    for (const mode of THEME_MODES) expect(parseThemeMode(mode)).toBe(mode);
    expect(parseThemeMode('invalid')).toBe('system');
    expect(parseThemeMode(null)).toBe('system');
  });

  it('migra los temas retirados (T11): Medianoche y Brasa a Oscuro, Amanecer a Claro', () => {
    expect(parseThemeMode('midnight')).toBe('dark');
    expect(parseThemeMode('ember')).toBe('dark');
    expect(parseThemeMode('sunrise')).toBe('light');
    expect(migrateThemeMode('toString')).toBe('system');
  });

  it('resuelve system según el SO y respeta el tema explícito', () => {
    expect(resolveThemeId('system', true)).toBe('dark');
    expect(resolveThemeId('system', false)).toBe('light');
    expect(resolveThemeId('contrast', false)).toBe('contrast');
    expect(resolveThemeId('light', true)).toBe('light');
  });

  it('quedan Claro, Oscuro y Alto contraste, cada uno con su esquema de color', () => {
    expect([...THEME_IDS]).toEqual(['light', 'dark', 'contrast']);
    for (const id of THEME_IDS) expect(['light', 'dark']).toContain(THEME_SCHEME[id]);
    expect(THEME_SCHEME.contrast).toBe('dark');
  });

  it('isThemeMode rechaza valores no listados (validación IPC), también los retirados', () => {
    expect(isThemeMode('contrast')).toBe(true);
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('ember')).toBe(false);
    expect(isThemeMode('neon')).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });

  it('todo tema tiene los colores de su miniatura', () => {
    for (const id of THEME_IDS) {
      const s = themeSwatches[id];
      for (const c of [s.panel, s.canvas, s.accent, s.card, s.edge, s.line]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
