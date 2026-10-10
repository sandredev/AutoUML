import { describe, expect, it } from 'vitest';
import { parseThemeMode, resolveThemeId, themeSwatches } from '../../../src/presentation/components/useTheme';
import { THEME_IDS, THEME_MODES, THEME_SCHEME, isThemeMode } from '../../../src/domain/rules/themes';

describe('useTheme helpers', () => {
  it('acepta solo modos conocidos y cae a system', () => {
    for (const mode of THEME_MODES) expect(parseThemeMode(mode)).toBe(mode);
    expect(parseThemeMode('invalid')).toBe('system');
    expect(parseThemeMode(null)).toBe('system');
  });

  it('resuelve system según el SO y respeta el tema explícito', () => {
    expect(resolveThemeId('system', true)).toBe('dark');
    expect(resolveThemeId('system', false)).toBe('light');
    expect(resolveThemeId('sunrise', true)).toBe('sunrise');
    expect(resolveThemeId('midnight', false)).toBe('midnight');
  });

  it('cada tema declara su esquema de color', () => {
    for (const id of THEME_IDS) expect(['light', 'dark']).toContain(THEME_SCHEME[id]);
    expect(THEME_SCHEME.sunrise).toBe('light');
    expect(THEME_SCHEME.midnight).toBe('dark');
  });

  it('isThemeMode rechaza valores no listados (validación IPC)', () => {
    expect(isThemeMode('ember')).toBe(true);
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('neon')).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });

  it('todo tema tiene muestras de color para la vista previa', () => {
    for (const id of THEME_IDS) expect(themeSwatches[id]).toHaveLength(3);
  });
});
