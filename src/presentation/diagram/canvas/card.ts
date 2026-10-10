// src/presentation/diagram/canvas/card.ts — tarjeta estilo PlantUML. Usa cardContentOf/geometryOf/FONTS: igual que la medida.
import type { TypeNode } from '../../../domain/diagram/model';
import { badgeColor, cardContentOf, geometryOf, moreText } from '../layout/cardModel';
import { CARD, DEFAULT_DETAIL, DEFAULT_DISPLAY, FONTS, type CardDisplay } from '../style/contract';
import type { NodeBox } from '../types';
import { resolveColor, textOn } from './color';

export interface CardTheme { card: string; cardBorder: string; cardFg: string; accent: string }

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
  },
): void {
  const c = cardContentOf(t, DEFAULT_DETAIL, o.summary, o.display ?? DEFAULT_DISPLAY);
  const g = geometryOf(c);
  const fill = resolveColor(ctx, t.color) ?? theme.card;
  const border = resolveColor(ctx, t.lineColor) ?? theme.cardBorder;
  const headFg = t.color ? textOn(fill) : theme.cardFg;

  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, CARD.radius);
  ctx.fillStyle = theme.card;
  ctx.fill();
  if (t.color) {
    // El color de PlantUML va en toda la tarjeta; la cabecera es lo que se lee primero.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
  ctx.lineWidth = o.selected ? o.lineWidth * 2 : o.lineWidth;
  ctx.strokeStyle = o.selected ? theme.accent : border;
  ctx.stroke();

  // Cabecera: insignia + (estereotipo arriba, nombre debajo).
  const r = CARD.badgeD / 2;
  const bx = b.x + CARD.padX + r;
  const by = b.y + g.headerH / 2;
  ctx.lineWidth = o.lineWidth;
  if (!c.noBadge) {
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = badgeColor(c.badge);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.stroke();
    // Las insignias tienen colores claros fijos (PlantUML): la letra va siempre en negro.
    ctx.fillStyle = '#000000';
    ctx.font = FONTS.pkg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.badge, bx, by + 0.5);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = b.x + b.w / 2;
  ctx.fillStyle = headFg;
  if (c.stereotype) {
    ctx.font = FONTS.stereo;
    ctx.fillText(c.stereotype, cx, b.y + 14);
    ctx.font = c.italic ? FONTS.nameItalic : FONTS.name;
    ctx.fillText(c.name, cx, b.y + 32);
  } else {
    ctx.font = c.italic ? FONTS.nameItalic : FONTS.name;
    ctx.fillText(c.name, cx, by);
  }
  if (!o.members || c.sections.length === 0) { ctx.textAlign = 'left'; return; }

  ctx.textAlign = 'left';
  let y = b.y + g.headerH;
  c.sections.forEach((rows, i) => {
    ctx.beginPath();
    ctx.moveTo(b.x, y);
    ctx.lineTo(b.x + b.w, y);
    ctx.strokeStyle = border;
    ctx.stroke();
    let ry = y + CARD.sectionPadY + CARD.rowH / 2;
    ctx.fillStyle = theme.cardFg;
    for (const row of rows) {
      ctx.font = row.isAbstract ? FONTS.rowItalic : FONTS.row;
      ctx.fillText(row.text, b.x + CARD.padX, ry);
      if (row.isStatic) {
        const w = ctx.measureText(row.text).width;
        ctx.fillRect(b.x + CARD.padX, ry + 6, w, 1);
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
