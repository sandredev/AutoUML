import { useCallback, useEffect, useState } from 'react';
import { THEME_SCHEME, isThemeMode, type ThemeId, type ThemeMode } from '../../shared/themes';

export type { ThemeId, ThemeMode };

const STORAGE_KEY = 'autouml-theme';

/** Colores de vista previa (fondo, superficie, acento) para el selector de temas. */
export const themeSwatches: Record<ThemeId, readonly [string, string, string]> = {
  light: ['#f4f5f8', '#ffffff', '#d9441f'],
  dark: ['#1b1c26', '#232433', '#ff6a45'],
  midnight: ['#171829', '#1e2033', '#f5d33b'],
  ember: ['#1c1613', '#261d19', '#ff5f3c'],
  sunrise: ['#fbf5ec', '#fffdf8', '#e0481f'],
  contrast: ['#000000', '#0a0a0f', '#f5d33b'],
};

export function parseThemeMode(raw: unknown): ThemeMode {
  return isThemeMode(raw) ? raw : 'system';
}

export function resolveThemeId(mode: ThemeMode, prefersDark: boolean): ThemeId {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

function readStoredMode(): ThemeMode {
  try {
    return parseThemeMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function prefersDarkNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}
/** Pinta los botones nativos de ventana con los colores de la barra de menús del tema activo. */
function syncWindowControls(root: HTMLElement): void {
  const styles = getComputedStyle(root);
  const background = styles.getPropertyValue('--bg-chrome').trim();
  const symbols = styles.getPropertyValue('--fg').trim();
  window.autouml?.setWindowControlsColors(background, symbols);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());

  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean): void => {
      const id = resolveThemeId(mode, dark);
      // data-theme siempre lleva el tema ya resuelto: el CSS y el lienzo (MutationObserver) solo miran ese atributo.
      root.dataset.theme = id;
      root.style.colorScheme = THEME_SCHEME[id];
      syncWindowControls(root);
    };
    apply(prefersDarkNow());
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // La selección sigue activa durante esta sesión si el almacenamiento está bloqueado.
    }
  }, []);

  return { mode, setMode };
}
