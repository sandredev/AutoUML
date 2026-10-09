// src/render/canvas/minimap.ts — minimapa con los colores del tema activo.
import type { LayoutResult, ViewState } from '../types';
import { visibleWorldRect } from './viewport';
import type { Theme } from './draw';

export function drawMinimap(
  canvas: HTMLCanvasElement,
  layout: LayoutResult,
  view: ViewState,
  viewW: number,
  viewH: number,
  theme: Theme,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0 || layout.bounds.w <= 0 || layout.bounds.h <= 0) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const pad = 8;
  const scale = Math.min((width - pad * 2) / layout.bounds.w, (height - pad * 2) / layout.bounds.h);
  const ox = (width - layout.bounds.w * scale) / 2 - layout.bounds.x * scale;
  const oy = (height - layout.bounds.h * scale) / 2 - layout.bounds.y * scale;

  ctx.strokeStyle = theme.pkg;
  ctx.globalAlpha = 0.6;
  for (const pkg of layout.packages) {
    ctx.strokeRect(ox + pkg.x * scale, oy + pkg.y * scale, pkg.w * scale, pkg.h * scale);
  }

  ctx.globalAlpha = 0.9;
  for (const node of layout.nodes) {
    const x = ox + node.x * scale;
    const y = oy + node.y * scale;
    const w = Math.max(1, node.w * scale);
    const h = Math.max(1, node.h * scale);
    ctx.fillStyle = theme.card;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.cardBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  const visible = visibleWorldRect(view, viewW, viewH);
  const vx = ox + visible.x * scale;
  const vy = oy + visible.y * scale;
  const vw = visible.w * scale;
  const vh = visible.h * scale;
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(vx, vy, vw, vh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vx, vy, vw, vh);
}
