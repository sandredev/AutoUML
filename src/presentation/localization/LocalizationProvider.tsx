
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { translate, type Locale, type MessageKey } from './translations';
import { readStoredLocale, writeStoredLocale, type KeyValueStore } from './localeStorage';

export type TranslateFn = (key: MessageKey, params?: Record<string, string | number>) => string;

interface LocalizationValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function browserLanguage(): string | null {
  return typeof navigator === 'undefined' ? null : navigator.language;
}

const LocalizationContext = createContext<LocalizationValue>({
  locale: 'es',
  setLocale: () => undefined,
  t: (key, params) => translate('es', key, params),
});

export function LocalizationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale(browserStore(), browserLanguage()));

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(browserStore(), next);
  }, []);

  const t = useCallback<TranslateFn>((key, params) => translate(locale, key, params), [locale]);

  const value = useMemo<LocalizationValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): LocalizationValue {
  return useContext(LocalizationContext);
}
