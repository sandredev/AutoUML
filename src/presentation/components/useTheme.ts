import { useCallback, useEffect, useState } from 'react';
import { THEME_SCHEME, migrateThemeMode, type ThemeId, type ThemeMode } from '../../domain/rules/themes';

export type { ThemeId, ThemeMode };

const STORAGE_KEY = 'autouml-theme';

/**
 * Colores de la miniatura de cada tema en Configuración: barra/paneles, lienzo, acento, tarjeta, borde de
 * tarjeta y separador. Son los mismos tokens de theme.css.
 */
export const themeSwatches: Record<ThemeId, { panel: string; canvas: string; accent: string; card: string; edge: string; line: string }> = {
  light: { panel: '#eef0f5', canvas: '#f8f9fb', accent: '#b8360f', card: '#ffffff', edge: '#454a62', line: '#d9dce5' },
  dark: { panel: '#1f202d', canvas: '#191a24', accent: '#ff6a45', card: '#252737', edge: '#6c7190', line: '#2e3042' },
  contrast: { panel: '#000000', canvas: '#000000', accent: '#f5d33b', card: '#000000', edge: '#ffffff', line: '#8a8db3' },
};

/** Modo guardado → modo válido (Medianoche y Brasa pasan a Oscuro; Amanecer, a Claro). */
export function parseThemeMode(raw: unknown): ThemeMode {
  return migrateThemeMode(raw);
}

export function resolveThemeId(mode: ThemeMode, prefersDark: boolean): ThemeId {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const mode = parseThemeMode(stored);
    // Un tema retirado se reescribe ya migrado: el menú y Configuración muestran el tema que se ve.
    if (stored !== null && stored !== mode) localStorage.setItem(STORAGE_KEY, mode);
    return mode;
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
