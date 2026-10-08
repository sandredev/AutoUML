import { describe, expect, it } from 'vitest';
import { nextThemeMode, parseThemeMode, resolveEffectiveTheme } from './useTheme';

describe('useTheme helpers (issue #1)', () => {
  it('parsea solo modos válidos', () => {
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('system')).toBe('system');
    expect(parseThemeMode('banana')).toBe('system');
    expect(parseThemeMode(null)).toBe('system');
  });

  it('cicla Sistema → Claro → Oscuro → Sistema', () => {
    expect(nextThemeMode('system')).toBe('light');
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
  });

  it('resuelve el tema efectivo', () => {
    expect(resolveEffectiveTheme('light', true)).toBe('light');
    expect(resolveEffectiveTheme('dark', false)).toBe('dark');
    expect(resolveEffectiveTheme('system', true)).toBe('dark');
    expect(resolveEffectiveTheme('system', false)).toBe('light');
  });
});
