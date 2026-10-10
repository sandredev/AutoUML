
import { describe, expect, it } from 'vitest';
import { detectLocale, parseLocale, translate, withShortcut } from '../../../src/presentation/localization/translations';
import { localeStorageKey, readStoredLocale, writeStoredLocale, type KeyValueStore } from '../../../src/presentation/localization/localeStorage';
import { filterCategories, pickActive } from '../../../src/presentation/components/settingsModel';

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

describe('localización (issue #1)', () => {
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

describe('textos del visor (T4)', () => {
  it('viewerLabels traduce todas las claves en ambos idiomas, sin dejar la clave a la vista', async () => {
    const { viewerLabels } = await import('../../../src/presentation/localization/viewerLabels');
    for (const locale of ['es', 'en'] as const) {
      const labels = viewerLabels((key, params) => translate(locale, key, params));
      const texts = [
        ...Object.values(labels).filter((v): v is string => typeof v === 'string'),
        ...Object.values(labels.categories),
        ...Object.values(labels.relTypes),
      ];
      for (const text of texts) expect(text.startsWith('viewer.')).toBe(false);
    }
    const en = viewerLabels((key, params) => translate('en', key, params));
    expect(en.moreMembers).toBe('… +{n} more');
    expect(en.relTypes.EXTENDS).toBe('Inheritance');
  });
});
