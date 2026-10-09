
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { translate, type Locale, type MessageKey } from './catalog';
import { readStoredLocale, writeStoredLocale, type KeyValueStore } from './storage';

export type TranslateFn = (key: MessageKey, params?: Record<string, string | number>) => string;

interface I18nValue {
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

const I18nContext = createContext<I18nValue>({
  locale: 'es',
  setLocale: () => undefined,
  t: (key, params) => translate('es', key, params),
});

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale(browserStore(), browserLanguage()));

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(browserStore(), next);
  }, []);

  const t = useCallback<TranslateFn>((key, params) => translate(locale, key, params), [locale]);

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
