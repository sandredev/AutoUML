/**
 * Registro único de temas. Lo usan main (validación IPC y menú) y el renderer.
 * 'system' no es un tema: se resuelve a 'light' o 'dark' según el SO.
 */
export const THEME_IDS = ['light', 'dark', 'midnight', 'ember', 'sunrise', 'contrast'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_MODES = ['system', ...THEME_IDS] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export type ColorScheme = 'light' | 'dark';

/** Esquema de color de cada tema (controles nativos, barras de scroll, etc.). */
export const THEME_SCHEME: Record<ThemeId, ColorScheme> = {
  light: 'light',
  dark: 'dark',
  midnight: 'dark',
  ember: 'dark',
  sunrise: 'light',
  contrast: 'dark',
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}
