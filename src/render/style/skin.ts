// src/render/style/skin.ts — aplica skinparam al tema del lienzo (puro).
import { plantColor, type Skinparams } from '../../core/skinparam';
import type { Theme } from '../canvas/draw';

/** Tema con los colores de skinparam encima. Sin skinparam devuelve el MISMO objeto. */
export function applySkin(theme: Theme, sp: Skinparams | undefined): Theme {
  if (!sp) return theme;
  const bg = plantColor(sp.backgroundcolor);
  const card = plantColor(sp.classbackgroundcolor);
  const border = plantColor(sp.classbordercolor);
  const edge = plantColor(sp.arrowcolor);
  const pkgBg = plantColor(sp.packagebackgroundcolor);
  if (!bg && !card && !border && !edge && !pkgBg) return theme;
  const out: Theme = { ...theme };
  if (bg) out.bg = bg;
  if (card) out.card = card;
  if (border) out.cardBorder = border;
  if (edge) out.edge = edge;
  if (pkgBg) out.pkgBg = pkgBg;
  return out;
}

export function linetypeOf(sp: Skinparams | undefined): 'ortho' | 'polyline' | undefined {
  const v = sp?.linetype?.toLowerCase();
  return v === 'ortho' || v === 'polyline' ? v : undefined;
}

/** false con "skinparam classAttributeIconSize 0". */
export function visibilityIconsOf(sp: Skinparams | undefined): boolean {
  const v = sp?.classattributeiconsize?.trim();
  return v === undefined || Number(v) !== 0;
}

/** Clave estable de los skinparam que afectan al color (para invalidar el tema cacheado). */
export function skinKey(sp: Skinparams | undefined): string {
  if (!sp) return '';
  return ['backgroundcolor', 'classbackgroundcolor', 'classbordercolor', 'arrowcolor', 'packagebackgroundcolor']
    .map((k) => sp[k] ?? '')
    .join('|');
}
