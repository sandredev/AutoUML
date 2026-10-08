import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'autouml-theme';

export function parseThemeMode(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === 'system') return 'light';
  if (mode === 'light') return 'dark';
  return 'system';
}

export function resolveEffectiveTheme(mode: ThemeMode, prefersDark: boolean): EffectiveTheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
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

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [effective, setEffective] = useState<EffectiveTheme>(() => resolveEffectiveTheme(readStoredMode(), prefersDarkNow()));

  useEffect(() => {
    const root = document.documentElement;
    const apply = (current: ThemeMode, dark: boolean): void => {
      const next = resolveEffectiveTheme(current, dark);
      setEffective(next);
      if (current === 'system') root.removeAttribute('data-theme');
      else root.dataset.theme = current;
      root.style.colorScheme = next;
    };
    apply(mode, prefersDarkNow());
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => apply(mode, event.matches);
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

  return { mode, effective, setMode };
}
