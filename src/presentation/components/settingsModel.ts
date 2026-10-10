
import type { MessageKey } from '../localization/translations';

export type SettingsCategory = 'appearance' | 'language' | 'about';

export interface CategoryDef {
  id: SettingsCategory;
  title: MessageKey;
  terms: readonly MessageKey[];
}

export const settingsCategories: readonly CategoryDef[] = [
  {
    id: 'appearance',
    title: 'settings.appearance',
    terms: ['settings.themeLabel', 'settings.themeSystem', 'settings.themeLight', 'settings.themeDark'],
  },
  {
    id: 'language',
    title: 'settings.language',
    terms: ['settings.languageLabel', 'settings.langEs', 'settings.langEn'],
  },
  {
    id: 'about',
    title: 'settings.about',
    terms: ['settings.aboutDesc', 'settings.aboutRule'],
  },
];

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function filterCategories(
  query: string,
  t: (key: MessageKey) => string,
  categories: readonly CategoryDef[] = settingsCategories,
): CategoryDef[] {
  const q = normalize(query);
  if (q === '') return categories.slice();
  return categories.filter((c) => {
    if (normalize(t(c.title)).includes(q)) return true;
    return c.terms.some((k) => normalize(t(k)).includes(q));
  });
}

export function pickActive(current: SettingsCategory, visible: readonly CategoryDef[]): SettingsCategory | null {
  if (visible.some((c) => c.id === current)) return current;
  return visible[0]?.id ?? null;
}
