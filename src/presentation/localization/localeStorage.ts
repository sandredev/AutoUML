
import { defaultLocale, detectLocale, parseLocale, type Locale } from './translations';

export const localeStorageKey = 'autouml-locale';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredLocale(store: KeyValueStore | null, navigatorLanguage?: string | null): Locale {
  if (!store) return detectLocale(navigatorLanguage);
  try {
    const raw = store.getItem(localeStorageKey);
    if (raw === null) return detectLocale(navigatorLanguage);
    return parseLocale(raw);
  } catch {
    return defaultLocale;
  }
}

export function writeStoredLocale(store: KeyValueStore | null, locale: Locale): boolean {
  if (!store) return false;
  try {
    store.setItem(localeStorageKey, locale);
    return true;
  } catch {
    return false;
  }
}
