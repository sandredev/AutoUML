// src/presentation/diagram/canvas/card.ts — tarjeta del diagrama. Usa cardContentOf/geometryOf/FONTS: igual que la medida.
// T11 (anatomía del nodo): insignia cuadrada tintada con la letra de la categoría, nombre a la izquierda, compartimentos
// separados por una línea, selección = borde de 2 px de acento + cabecera tintada.
import type { Category, TypeNode } from '../../../domain/diagram/model';
import { cardContentOf, geometryOf, moreText } from '../layout/cardModel';
import { CARD, DEFAULT_DETAIL, DEFAULT_DISPLAY, FONTS, type CardDisplay } from '../style/contract';
import type { NodeBox } from '../types';
import { parseRgb, readableOn, resolveColor, textOn } from './color';

export interface CardTheme {
  card: string;
  cardBorder: string;
  cardFg: string;
  accent: string;
  /** Color por categoría (insignia). Sin él, el del texto. */
  cat?: Partial<Record<Category, string>>;
}

/** Mezcla `color` sobre `base` con opacidad `a` (los dos #rrggbb o rgb()); si no se entienden, `color`. */
export function mix(color: string, base: string, a: number): string {
  const c = parseRgb(color);
  const b = parseRgb(base);
  if (!c || !b) return color;
  const ch = (i: 0 | 1 | 2): number => Math.round(c[i] * a + b[i] * (1 - a));
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

export function drawCard(
  ctx: CanvasRenderingContext2D,
  t: TypeNode,
  b: NodeBox,
  theme: CardTheme,
  o: {
    summary: boolean;
    members: boolean;
    selected: boolean;
    lineWidth: number;
    /** hide circle / stereotype / empty… y classAttributeIconSize 0 (la medida usa lo mismo). */
    display?: Readonly<CardDisplay> | undefined;
    /** Plantilla traducida de "… +{n} más". */
    moreTemplate?: string | undefined;
    /** Mapa de calor (T9): relleno de toda la tarjeta; manda sobre el color de PlantUML y todo el texto se adapta. */
    heat?: string | undefined;
  },
): void {
  const c = cardContentOf(t, DEFAULT_DETAIL, o.summary, o.display ?? DEFAULT_DISPLAY);
  const g = geometryOf(c);
  const heat = o.heat;
  const fill = heat ?? resolveColor(ctx, t.color) ?? theme.card;
  const border = resolveColor(ctx, t.lineColor) ?? theme.cardBorder;
  const heatFg = heat ? readableOn(heat) : null;
  const headFg = heatFg ?? (t.color ? textOn(fill) : theme.cardFg);
  const rowFg = heatFg ?? theme.cardFg;
  const lw = o.lineWidth;

  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, CARD.radius);
  ctx.fillStyle = theme.card;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (heat || t.color) {
    // El color de PlantUML (o el del calor) va en toda la tarjeta; la cabecera es lo que se lee primero.
    ctx.fillStyle = fill;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  } else if (o.selected) {
    // Seleccionada: cabecera tintada con el acento (además del borde).
    ctx.fillStyle = mix(theme.accent, theme.card, 0.16);
    ctx.fillRect(b.x, b.y, b.w, g.headerH);
  }
  ctx.restore();

  // Cabecera: insignia + (estereotipo arriba, nombre debajo), alineados a la izquierda.
  const by = b.y + g.headerH / 2;
  let textX = b.x + CARD.padX;
  if (!c.noBadge) {
    const d = CARD.badgeD;
    const bx = b.x + CARD.padX;
    const catColor = theme.cat?.[c.category] ?? headFg;
    const badgeColor = heat || t.color ? headFg : catColor;
    ctx.beginPath();
    ctx.roundRect(bx, by - d / 2, d, d, 4);
    ctx.fillStyle = heat || t.color ? mix(headFg, fill, 0.16) : mix(catColor, theme.card, 0.16);
    ctx.fill();
    ctx.fillStyle = badgeColor;
    ctx.font = FONTS.pkg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.badge, bx + d / 2, by + 0.5);
    textX = bx + d + CARD.badgeGap;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = headFg;
  if (c.stereotype) {
    ctx.font = FONTS.stereo;
    ctx.fillText(c.stereotype, textX, b.y + 14);
    ctx.font = c.italic ? FONTS.nameItalic : FONTS.name;
    ctx.fillText(c.name, textX, b.y + 33);
  } else {
    ctx.font = c.italic ? FONTS.nameItalic : FONTS.name;
    ctx.fillText(c.name, textX, by + 0.5);
  }

  if (o.members && c.sections.length > 0) {
    let y = b.y + g.headerH;
    c.sections.forEach((rows, i) => {
      ctx.beginPath();
      ctx.moveTo(b.x, y);
      ctx.lineTo(b.x + b.w, y);
      ctx.strokeStyle = border;
      ctx.lineWidth = lw;
      ctx.stroke();
      let ry = y + CARD.sectionPadY + CARD.rowH / 2;
      ctx.fillStyle = rowFg;
      for (const row of rows) {
        ctx.font = row.isAbstract ? FONTS.rowItalic : FONTS.row;
        ctx.fillText(row.text, b.x + CARD.padX, ry);
        if (row.isStatic) {
          const w = ctx.measureText(row.text).width;
          ctx.fillRect(b.x + CARD.padX, ry + 7, w, 1);
        }
        ry += CARD.rowH;
      }
      if (g.hasMoreRow && i === c.sections.length - 1) {
        ctx.font = FONTS.rowItalic;
        ctx.fillText(moreText(c.hiddenCount, o.moreTemplate), b.x + CARD.padX, ry);
      }
      y += g.sectionH[i] ?? 0;
    });
  }

  // Borde al final (encima del tinte): 1 px; seleccionada, 2 px de acento.
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, CARD.radius);
  ctx.lineWidth = o.selected ? lw * 2 : lw;
  ctx.strokeStyle = o.selected ? theme.accent : border;
  ctx.stroke();
}
