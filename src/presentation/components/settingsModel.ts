
import type { MessageKey } from '../localization/translations';

export type SettingsCategory = 'appearance' | 'language' | 'about';

export interface CategoryDef {
  id: SettingsCategory;
  title: MessageKey;
}

export const settingsCategories: readonly CategoryDef[] = [
  { id: 'appearance', title: 'settings.appearance' },
  { id: 'language', title: 'settings.language' },
  { id: 'about', title: 'settings.about' },
];
