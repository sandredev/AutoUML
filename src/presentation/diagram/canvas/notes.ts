// src/presentation/diagram/canvas/notes.ts — dibujo de notas estilo PlantUML (papel con la esquina doblada).
import { NOTE, overlaps } from '../layout/notes';
import { FONTS } from '../style/contract';
import type { NodeBox, NoteBox } from '../types';
import type { Rect } from './viewport';

export interface NoteTheme { noteBg: string; noteBorder: string; noteFg: string }

function clipToBox(r: Rect, tx: number, ty: number): [number, number] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy));
  return [cx + dx * s, cy + dy * s];
}

export function drawNotes(
  ctx: CanvasRenderingContext2D,
  notes: readonly NoteBox[],
  nodes: ReadonlyMap<string, NodeBox>,
  theme: NoteTheme,
  px: number,
  visible: Rect,
): void {
  const f = NOTE.fold;
  for (const n of notes) {
    const anchor = n.anchor !== undefined ? nodes.get(n.anchor) : undefined;
    if (!overlaps(n, visible, 0) && !(anchor && overlaps(anchor, visible, 0))) continue;
    if (anchor) {
      const [sx, sy] = clipToBox(n, anchor.x + anchor.w / 2, anchor.y + anchor.h / 2);
      const [tx, ty] = clipToBox(anchor, n.x + n.w / 2, n.y + n.h / 2);
      ctx.beginPath();
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = theme.noteBorder;
      ctx.lineWidth = px;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const { x, y, w, h } = n;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - f, y);
    ctx.lineTo(x + w, y + f);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = theme.noteBg;
    ctx.fill();
    ctx.strokeStyle = theme.noteBorder;
    ctx.lineWidth = px;
    ctx.stroke();
    // Esquina doblada
    ctx.beginPath();
    ctx.moveTo(x + w - f, y);
    ctx.lineTo(x + w - f, y + f);
    ctx.lineTo(x + w, y + f);
    ctx.stroke();
    ctx.fillStyle = theme.noteFg;
    ctx.font = FONTS.row;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    n.lines.forEach((line, i) => ctx.fillText(line, x + NOTE.pad, y + NOTE.pad + (i + 0.5) * NOTE.lineH));
  }
}
