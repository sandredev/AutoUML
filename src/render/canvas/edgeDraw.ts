// src/render/canvas/edgeDraw.ts — arista completa: cabezas por extremo, estilo, multiplicidades y etiqueta.
import type { RelationshipModel } from '../../core/model';
import { FONTS } from '../style/contract';
import type { EdgePath } from '../types';
import { resolveColor } from './color';
import {
  CORNER_RADIUS, endLabelPos, firstSegment, headGeometry, headsOf, labelAnchor, lastSegment,
  roundedCorners, simplify, trimEnds, type HeadShape,
} from './edgePath';

export interface EdgeTheme { edge: string; bg: string; fg: string; accent: string }

function strokePath(ctx: CanvasRenderingContext2D, pts: number[], orthogonal: boolean): void {
  ctx.beginPath();
  if (orthogonal) {
    for (const op of roundedCorners(pts, CORNER_RADIUS)) {
      if (op.op === 'move') ctx.moveTo(op.x, op.y);
      else if (op.op === 'line') ctx.lineTo(op.x, op.y);
      else ctx.arcTo(op.x1, op.y1, op.x2, op.y2, op.r);
    }
  } else {
    ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
    for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
  }
  ctx.stroke();
}

function drawShapes(ctx: CanvasRenderingContext2D, shapes: HeadShape[], color: string, bg: string): void {
  ctx.setLineDash([]);
  for (const s of shapes) {
    ctx.beginPath();
    if (s.kind === 'circle') {
      ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
    } else {
      ctx.moveTo(s.pts[0] ?? 0, s.pts[1] ?? 0);
      for (let i = 2; i + 1 < s.pts.length; i += 2) ctx.lineTo(s.pts[i] ?? 0, s.pts[i + 1] ?? 0);
      if (s.closed) ctx.closePath();
    }
    if (s.fill !== 'none') {
      ctx.fillStyle = s.fill === 'line' ? color : bg;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function labelBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string): void {
  ctx.font = FONTS.edge;
  const w = ctx.measureText(text).width;
  const pad = 2;
  ctx.fillStyle = bg;
  ctx.fillRect(x - w / 2 - pad, y - 7 - pad, w + 2 * pad, 14 + 2 * pad);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export function drawEdgeFull(
  ctx: CanvasRenderingContext2D,
  e: EdgePath,
  rel: RelationshipModel | undefined,
  theme: EdgeTheme,
  o: { labels: boolean; heads: boolean; lineWidth: number; highlighted?: boolean },
): void {
  const pts = simplify(e.points);
  if (pts.length < 4) return;
  const heads = headsOf(rel ?? { type: e.type });
  const color = o.highlighted ? theme.accent : resolveColor(ctx, rel?.style?.color) ?? theme.edge;
  const dashed = rel?.style?.dashed ?? (e.type === 'DEPENDENCY' || e.type === 'IMPLEMENTS');
  const first = firstSegment(pts);
  const last = lastSegment(pts);
  const sh = o.heads && first ? headGeometry(heads.source, ...first) : { inset: 0, shapes: [] };
  const th = o.heads && last ? headGeometry(heads.target, ...last) : { inset: 0, shapes: [] };

  ctx.strokeStyle = color;
  ctx.lineWidth = o.lineWidth * (rel?.style?.bold ? 2 : 1);
  ctx.setLineDash(dashed ? [6 * o.lineWidth, 4 * o.lineWidth] : []);
  strokePath(ctx, trimEnds(pts, sh.inset, th.inset), e.routing === 'orthogonal');

  if (o.heads) {
    ctx.lineWidth = o.lineWidth;
    drawShapes(ctx, sh.shapes, color, theme.bg);
    drawShapes(ctx, th.shapes, color, theme.bg);
  }
  ctx.setLineDash([]);
  if (!o.labels) return;

  if (rel?.sourceLabel && first) {
    const p = endLabelPos(...first, 14 + sh.inset);
    labelBox(ctx, rel.sourceLabel, p.x, p.y, theme.bg, theme.fg);
  }
  if (rel?.targetLabel && last) {
    const p = endLabelPos(...last, 14 + th.inset);
    labelBox(ctx, rel.targetLabel, p.x, p.y, theme.bg, theme.fg);
  }
  const text = rel?.label ?? e.label;
  if (text) {
    const a = labelAnchor(pts);
    if (a) {
      const t = rel?.labelArrow === 'forward' ? text + ' ▶' : rel?.labelArrow === 'backward' ? '◀ ' + text : text;
      labelBox(ctx, t, a.x, a.y, theme.bg, theme.fg);
    }
  }
}
