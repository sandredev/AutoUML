/**
 * Registro único de temas. Lo usan main (validación IPC y menú) y el renderer.
 * 'system' no es un tema: se resuelve a 'light' o 'dark' según el SO.
 */
export const THEME_IDS = ['light', 'dark', 'contrast'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_MODES = ['system', ...THEME_IDS] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export type ColorScheme = 'light' | 'dark';

/** Esquema de color de cada tema (controles nativos, barras de scroll, etc.). */
export const THEME_SCHEME: Record<ThemeId, ColorScheme> = {
  light: 'light',
  dark: 'dark',
  contrast: 'dark',
};

/** Temas retirados en el rediseño y a cuál pasa quien los tenía guardados. */
export const LEGACY_THEMES: Readonly<Record<string, ThemeId>> = {
  midnight: 'dark',
  ember: 'dark',
  sunrise: 'light',
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

/** Modo válido a partir de lo guardado: los temas retirados se migran y lo desconocido cae a 'system'. */
export function migrateThemeMode(raw: unknown): ThemeMode {
  if (isThemeMode(raw)) return raw;
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_THEMES, raw)) return LEGACY_THEMES[raw] as ThemeId;
  return 'system';
}
