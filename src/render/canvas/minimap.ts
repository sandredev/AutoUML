// src/render/canvas/minimap.ts — minimapa con los colores del tema activo e interacción (T4).
import type { LayoutResult, ViewState } from '../types';
import { visibleWorldRect, type Rect } from './viewport';
import type { Theme } from './draw';

const PAD = 8;

export interface MinimapTransform { scale: number; ox: number; oy: number }

/** Transformación mundo → minimapa (px CSS); null si no hay nada que dibujar. */
export function minimapTransform(bounds: Rect, width: number, height: number): MinimapTransform | null {
  if (width <= 0 || height <= 0 || bounds.w <= 0 || bounds.h <= 0) return null;
  const scale = Math.min((width - PAD * 2) / bounds.w, (height - PAD * 2) / bounds.h);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return {
    scale,
    ox: (width - bounds.w * scale) / 2 - bounds.x * scale,
    oy: (height - bounds.h * scale) / 2 - bounds.y * scale,
  };
}

/** Punto del minimapa (px CSS) → mundo. */
export function minimapToWorld(t: MinimapTransform, mx: number, my: number): { x: number; y: number } {
  return { x: (mx - t.ox) / t.scale, y: (my - t.oy) / t.scale };
}

/** Vista con el mismo zoom que centra el punto de mundo (x, y) en un lienzo de w×h. */
export function centerViewOn(view: ViewState, x: number, y: number, w: number, h: number): ViewState {
  return { scale: view.scale, tx: w / 2 - x * view.scale, ty: h / 2 - y * view.scale };
}

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
  const t = minimapTransform(layout.bounds, width, height);
  if (!t) return;
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

  const { scale, ox, oy } = t;

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

  if (layout.notes && layout.notes.length > 0) {
    ctx.fillStyle = theme.noteBg;
    for (const n of layout.notes) ctx.fillRect(ox + n.x * scale, oy + n.y * scale, Math.max(1, n.w * scale), Math.max(1, n.h * scale));
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
