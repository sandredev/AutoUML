import type { Category, DiagramModel } from '../../core/model';
import type { LayoutResult, ViewState } from '../types';
import { visibleWorldRect } from './viewport';
import type { Theme } from './draw';

const categoryCache = new WeakMap<DiagramModel, Map<string, Category>>();

function categoriesOf(model: DiagramModel): Map<string, Category> {
  let categories = categoryCache.get(model);
  if (!categories) {
    categories = new Map(model.types.map((type) => [type.id, type.category]));
    categoryCache.set(model, categories);
  }
  return categories;
}

export function drawMinimap(
  canvas: HTMLCanvasElement,
  model: DiagramModel,
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
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const pad = 8;
  const scale = Math.min((width - pad * 2) / layout.bounds.w, (height - pad * 2) / layout.bounds.h);
  const ox = (width - layout.bounds.w * scale) / 2 - layout.bounds.x * scale;
  const oy = (height - layout.bounds.h * scale) / 2 - layout.bounds.y * scale;
  const point = (x: number, y: number): [number, number] => [ox + x * scale, oy + y * scale];

  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = theme.border;
  for (const pkg of layout.packages) {
    ctx.strokeRect(ox + pkg.x * scale, oy + pkg.y * scale, pkg.w * scale, pkg.h * scale);
  }

  const categoryById = categoriesOf(model);
  for (const node of layout.nodes) {
    const [x, y] = point(node.x, node.y);
    const color: string = node.packageName
      ? theme.accent
      : theme.cat[categoryById.get(node.id) ?? 'class'];
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(1, node.w * scale), Math.max(1, node.h * scale));
  }

  const visible = visibleWorldRect(view, viewW, viewH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  ctx.fillStyle = theme.accent;
  const vx = ox + visible.x * scale;
  const vy = oy + visible.y * scale;
  const vw = visible.w * scale;
  const vh = visible.h * scale;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(vx, vy, vw, vh);
  ctx.globalAlpha = 1;
  ctx.strokeRect(vx, vy, vw, vh);
}
