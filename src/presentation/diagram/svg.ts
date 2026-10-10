// Exportador SVG vectorial (texto como texto). Puro: sin React, sin canvas, sin Electron.
// Los colores son fijos de tema claro para que la exportación no dependa del tema de la app.
import type { LayoutResult } from './types';

/** Contenido textual de una tarjeta (lo aporta el llamador desde el DiagramModel). */
export interface SvgCardContent {
  name: string;
  members: string[];
}

export interface SvgOptions {
  fontFamily?: string;
  /** Margen alrededor del diagrama, en px. Por defecto 32. */
  padding?: number;
  /** Fondo del documento; null = transparente. Por defecto blanco. */
  background?: string | null;
  title?: string;
  /** Texto por tarjeta (id → contenido); sin entrada se usa el id como nombre. */
  cards?: ReadonlyMap<string, SvgCardContent>;
}

const CARD_FILL = '#F1F1F1';
const INK = '#181818';
const PKG_STROKE = '#555b62';
const NOTE_FILL = '#FEFECE';
const FOLD = 12;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Serializa el layout a SVG: tarjetas (rect + nombre + miembros con el w/h del
 * layout), aristas (path de points), notas (path con doblez + líneas) y
 * paquetes (rect + etiqueta). Devuelve el SVG y su tamaño en px.
 */
export function diagramToSvg(layout: LayoutResult, opts?: SvgOptions): { svg: string; width: number; height: number } {
  const font = opts?.fontFamily ?? 'system-ui, sans-serif';
  const pad = opts?.padding ?? 32;
  const background = opts?.background === undefined ? '#ffffff' : opts.background;
  const cards = opts?.cards;
  const b = layout.bounds;
  const width = Math.max(1, Math.ceil(b.w + 2 * pad));
  const height = Math.max(1, Math.ceil(b.h + 2 * pad));
  const ox = pad - b.x;
  const oy = pad - b.y;
  const X = (x: number): string => num(x + ox);
  const Y = (y: number): string => num(y + oy);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(font)}">`);
  if (opts?.title) out.push(`<title>${escapeXml(opts.title)}</title>`);
  if (background !== null) out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`);

  for (const p of layout.packages) {
    out.push(`<rect x="${X(p.x)}" y="${Y(p.y)}" width="${num(p.w)}" height="${num(p.h)}" fill="none" stroke="${PKG_STROKE}" stroke-width="1"/>`);
    out.push(`<text x="${X(p.x + 8)}" y="${Y(p.y + 18)}" font-size="12" fill="${PKG_STROKE}">${escapeXml(p.name)}</text>`);
  }

  for (const n of layout.nodes) {
    const content = cards?.get(n.id);
    const name = content?.name ?? n.label ?? n.id;
    const members = content?.members ?? [];
    out.push(`<rect x="${X(n.x)}" y="${Y(n.y)}" width="${num(n.w)}" height="${num(n.h)}" fill="${CARD_FILL}" stroke="${INK}" stroke-width="1"/>`);
    out.push(`<text x="${X(n.x + 8)}" y="${Y(n.y + 18)}" font-size="13" font-weight="bold" fill="#000000">${escapeXml(name)}</text>`);
    members.forEach((m, i) => {
      out.push(`<text x="${X(n.x + 8)}" y="${Y(n.y + 36 + i * 14)}" font-size="11" fill="#000000">${escapeXml(m)}</text>`);
    });
  }

  for (const e of layout.edges) {
    const d = e.points.length >= 4
      ? `M ${X(e.points[0] ?? 0)} ${Y(e.points[1] ?? 0)}` + edgeTail(e.points, X, Y)
      : '';
    if (d !== '') out.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.5"/>`);
    if (e.label) {
      const mid = e.points.length >= 4 ? Math.floor(e.points.length / 4) * 2 : 0;
      out.push(`<text x="${X((e.points[mid] ?? 0) + 4)}" y="${Y((e.points[mid + 1] ?? 0) - 4)}" font-size="11" fill="#000000">${escapeXml(e.label)}</text>`);
    }
  }

  for (const note of layout.notes ?? []) {
    const x = note.x + ox;
    const y = note.y + oy;
    const f = Math.min(FOLD, note.w / 2, note.h / 2);
    out.push(`<path d="M ${num(x)} ${num(y)} H ${num(x + note.w - f)} L ${num(x + note.w)} ${num(y + f)} V ${num(y + note.h)} H ${num(x)} Z" fill="${NOTE_FILL}" stroke="${INK}" stroke-width="1"/>`);
    out.push(`<path d="M ${num(x + note.w - f)} ${num(y)} V ${num(y + f)} H ${num(x + note.w)}" fill="none" stroke="${INK}" stroke-width="1"/>`);
    note.lines.forEach((line, i) => {
      out.push(`<text x="${num(x + 8)}" y="${num(y + 20 + i * 14)}" font-size="11" fill="#000000">${escapeXml(line)}</text>`);
    });
  }

  out.push('</svg>');
  return { svg: out.join('\n'), width, height };
}

function edgeTail(points: number[], X: (x: number) => string, Y: (y: number) => string): string {
  let d = '';
  for (let i = 2; i + 1 < points.length; i += 2) d += ` L ${X(points[i] ?? 0)} ${Y(points[i + 1] ?? 0)}`;
  return d;
}
