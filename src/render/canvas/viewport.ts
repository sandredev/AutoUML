// src/render/canvas/viewport.ts — transformaciones mundo↔pantalla (puro).
import type { ViewState } from '../types';

export interface Rect { x: number; y: number; w: number; h: number }

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** true si el lienzo tiene un tamaño dibujable. */
export function canPaint(size: { w: number; h: number }): boolean {
  return Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0;
}

export function worldToScreen(v: ViewState, x: number, y: number): { x: number; y: number } {
  return { x: x * v.scale + v.tx, y: y * v.scale + v.ty };
}

export function screenToWorld(v: ViewState, x: number, y: number): { x: number; y: number } {
  return { x: (x - v.tx) / v.scale, y: (y - v.ty) / v.scale };
}

/** Zoom manteniendo fijo el punto de pantalla (cx, cy). */
export function zoomAt(view: ViewState, factor: number, cx: number, cy: number, min = MIN_SCALE, max = MAX_SCALE): ViewState {
  const scale = clamp(view.scale * factor, min, max);
  if (!Number.isFinite(scale) || scale <= 0) return view;
  const k = scale / view.scale;
  return { scale, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k };
}

export function panBy(view: ViewState, dx: number, dy: number): ViewState {
  return { scale: view.scale, tx: view.tx + dx, ty: view.ty + dy };
}

export function fitToBounds(bounds: Rect, viewW: number, viewH: number, padding = 40, maxScale = 2): ViewState {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  if (bounds.w <= 0 && bounds.h <= 0) return { scale: 1, tx: viewW / 2 - cx, ty: viewH / 2 - cy };
  const aw = Math.max(1, viewW - 2 * padding);
  const ah = Math.max(1, viewH - 2 * padding);
  const raw = Math.min(bounds.w > 0 ? aw / bounds.w : Infinity, bounds.h > 0 ? ah / bounds.h : Infinity);
  const scale = clamp(raw, MIN_SCALE, maxScale);
  return { scale, tx: viewW / 2 - cx * scale, ty: viewH / 2 - cy * scale };
}

export function visibleWorldRect(view: ViewState, viewW: number, viewH: number): Rect {
  const p = screenToWorld(view, 0, 0);
  return { x: p.x, y: p.y, w: viewW / view.scale, h: viewH / view.scale };
}
