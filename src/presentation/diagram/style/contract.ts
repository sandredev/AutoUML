// src/presentation/diagram/style/contract.ts — CONTRATO COMPARTIDO del render "estilo PlantUML".
// Solo tipos y constantes. NO modificar sin avisar.
import type { Category, Visibility } from '../../../domain/diagram/model';

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
  /** T4: true si la insignia (C, I, E…) no se dibuja ("hide circle"). La medida lo tiene en cuenta. */
  noBadge?: boolean;
}

/**
 * T4: cómo se muestran las tarjetas según hide/show y skinparam. Lo usan IGUAL la medida (layout, en
 * el Worker: por eso es un objeto plano clonable) y el dibujo, para que la altura coincida.
 */
export interface CardDisplay {
  /** false con "hide circle". */
  showCircle: boolean;
  /** false con "hide stereotype". */
  showStereotype: boolean;
  /** "hide empty fields" / "hide empty members". */
  hideEmptyFields: boolean;
  /** "hide empty methods" / "hide empty members". */
  hideEmptyMethods: boolean;
  /** "hide fields" / "hide attributes". */
  hideFields: boolean;
  /** "hide methods". */
  hideMethods: boolean;
  /** false con "skinparam classAttributeIconSize 0": sin el prefijo de visibilidad (+ - # ~). */
  visibilityIcons: boolean;
}

export const DEFAULT_DISPLAY: Readonly<CardDisplay> = Object.freeze({
  showCircle: true,
  showStereotype: true,
  hideEmptyFields: false,
  hideEmptyMethods: false,
  hideFields: false,
  hideMethods: false,
  visibilityIcons: true,
});

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

const SANS = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Ubuntu, Cantarell, "DejaVu Sans", sans-serif';
const MONO = '"Cascadia Code", "JetBrains Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
/**
 * T11 (anatomía del nodo): nombre 13 px/600, miembros en monoespaciada de 12 px, estereotipo y etiquetas de
 * aristas a 12 px (mínimo de la interfaz). La medida (Worker) y el dibujo usan exactamente estas fuentes.
 */
export const FONTS: Record<FontKey, string> = {
  name: `600 13px ${SANS}`,
  nameItalic: `italic 600 13px ${SANS}`,
  stereo: `12px ${SANS}`,
  row: `12px ${MONO}`,
  rowItalic: `italic 12px ${MONO}`,
  pkg: `bold 12px ${SANS}`,
  edge: `12px ${SANS}`,
};

/**
 * Geometría de la tarjeta (T11): cabecera 32, relleno lateral 12, filas de 18 con 4 arriba y abajo por
 * compartimento, insignia cuadrada de 18 separada 8 del nombre, radio 4. El ancho sale de medir el texto.
 */
export const CARD = {
  minW: 120,
  padX: 12,
  headerH: 32,
  headerHStereo: 48,
  rowH: 18,
  sectionPadY: 4,
  badgeD: 18,
  badgeGap: 8,
  radius: 4,
} as const;

export const PACKAGE = {
  margin: 18,
  tabH: 22,
  tabPadX: 10,
  radius: 2,
} as const;
