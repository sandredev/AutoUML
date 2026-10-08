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

/** Tema manual Claro/Oscuro/Sistema (issue #1). Persiste en localStorage y expone data-theme. */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [effective, setEffective] = useState<EffectiveTheme>(() =>
    resolveEffectiveTheme(readStoredMode(), prefersDarkNow()),
  );

  useEffect(() => {
    const root = document.documentElement;
    const apply = (m: ThemeMode, dark: boolean): void => {
      const eff = resolveEffectiveTheme(m, dark);
      setEffective(eff);
      if (m === 'system') root.removeAttribute('data-theme');
      else root.dataset.theme = m;
      root.style.colorScheme = eff;
    };
    apply(mode, prefersDarkNow());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => apply(mode, e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // almacenamiento no disponible: el tema igual aplica en sesión
    }
  }, []);

  const cycle = useCallback(() => {
    setModeState((prev) => {
      const next = nextThemeMode(prev);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignorar
      }
      return next;
    });
  }, []);

  return { mode, effective, setMode, cycle };
}
