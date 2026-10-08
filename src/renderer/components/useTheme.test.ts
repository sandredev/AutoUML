import { describe, expect, it } from 'vitest';
import { nextThemeMode, parseThemeMode, resolveEffectiveTheme } from './useTheme';

describe('useTheme helpers', () => {
  it('acepta solo modos conocidos', () => {
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('system')).toBe('system');
    expect(parseThemeMode('invalid')).toBe('system');
  });

  it('resuelve el siguiente modo', () => {
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
