
import { describe, expect, it } from 'vitest';
import { detectLocale, parseLocale, translate, withShortcut } from './catalog';
import { localeStorageKey, readStoredLocale, writeStoredLocale, type KeyValueStore } from './storage';
import { filterCategories, pickActive } from '../components/settingsModel';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('i18n (issue #1)', () => {
  it('parsea locales válidos con fallback a español', () => {
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('es')).toBe('es');
    expect(parseLocale('fr')).toBe('es');
    expect(parseLocale(null)).toBe('es');
  });

  it('detecta el idioma del sistema solo la primera vez', () => {
    expect(detectLocale('en-US')).toBe('en');
    expect(detectLocale('pt-BR')).toBe('es');
    expect(readStoredLocale(memoryStore(), 'en-GB')).toBe('en');
  });

  it('persiste y relee la selección', () => {
    const store = memoryStore();
    expect(writeStoredLocale(store, 'en')).toBe(true);
    expect(store.data.get(localeStorageKey)).toBe('en');
    expect(readStoredLocale(store, 'es-CO')).toBe('en');
  });

  it('tolera almacenamiento roto o ausente', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(readStoredLocale(broken, 'en')).toBe('es');
    expect(writeStoredLocale(broken, 'en')).toBe(false);
    expect(readStoredLocale(null, null)).toBe('es');
  });

  it('traduce y compone atajos', () => {
    expect(translate('en', 'header.settings')).toBe('Settings');
    expect(translate('es', 'header.settings')).toBe('Ajustes');
    expect(withShortcut('Settings', 'Ctrl+,')).toBe('Settings (Ctrl+,)');
  });

  it('traduce los estados del overlay de drag and drop', () => {
    expect(translate('es', 'drop.prompt')).toBe('Suelta el diagrama para abrirlo');
    expect(translate('es', 'drop.hint', { extensions: '.puml, .pu' })).toBe('Formatos aceptados: .puml, .pu');
    expect(translate('en', 'drop.opening')).toBe('Opening diagram…');
  });

  it('filtra categorías por título u opción, sin acentos', () => {
    const tEs = (k: Parameters<typeof translate>[1]) => translate('es', k);
    expect(filterCategories('', tEs).length).toBe(3);
    expect(filterCategories('oscuro', tEs).map((c) => c.id)).toEqual(['appearance']);
    expect(filterCategories('english', tEs).map((c) => c.id)).toEqual(['language']);
    expect(filterCategories('apariencia', tEs).map((c) => c.id)).toEqual(['appearance']);
    expect(filterCategories('zzz', tEs)).toEqual([]);
    expect(pickActive('about', filterCategories('oscuro', tEs))).toBe('appearance');
    expect(pickActive('about', [])).toBeNull();
  });
});
