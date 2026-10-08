// src/render/style/contract.ts — CONTRATO COMPARTIDO del render "estilo PlantUML".
// Solo tipos y constantes. NO modificar sin avisar.
import type { Category, Visibility } from '../../core/model';

export type Badge = 'C' | 'I' | 'E' | 'A' | 'R' | '@' | 'S' | 'X' | '?';

export interface CardRow {
  visibility: Visibility | '';
  text: string;
  isStatic: boolean;
  isAbstract: boolean;
}

export interface CardContent {
  id: string;
  name: string;
  stereotype: string;
  badge: Badge;
  category: Category;
  italic: boolean;
  sections: CardRow[][];
  hiddenCount: number;
}

export interface DetailOptions {
  hideConstructors: boolean;
  hideAccessors: boolean;
  hideEmptyCompartments: boolean;
  maxRows: number;
}

export const DEFAULT_DETAIL: DetailOptions = {
  hideConstructors: false,
  hideAccessors: false,
  hideEmptyCompartments: true,
  maxRows: 40,
};

export interface CardGeometry {
  headerH: number;
  sectionH: number[];
  hasMoreRow: boolean;
}

export type FontKey = 'name' | 'nameItalic' | 'stereo' | 'row' | 'rowItalic' | 'pkg' | 'edge';
export type TextMeasurer = (text: string, font: FontKey) => number;

const SANS = '"DejaVu Sans", "Segoe UI", system-ui, -apple-system, Roboto, Ubuntu, sans-serif';
export const FONTS: Record<FontKey, string> = {
  name: `13px ${SANS}`,
  nameItalic: `italic 13px ${SANS}`,
  stereo: `10px ${SANS}`,
  row: `11px ${SANS}`,
  rowItalic: `italic 11px ${SANS}`,
  pkg: `bold 12px ${SANS}`,
  edge: `10px ${SANS}`,
};

export const CARD = {
  minW: 150,
  padX: 10,
  headerH: 34,
  headerHStereo: 46,
  rowH: 16,
  sectionPadY: 4,
  badgeD: 18,
  radius: 3,
} as const;

export const PACKAGE = {
  margin: 18,
  tabH: 22,
  tabPadX: 10,
  radius: 2,
} as const;
