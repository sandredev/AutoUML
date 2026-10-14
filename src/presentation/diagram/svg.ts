// Exportador SVG vectorial (texto como texto). Puro: sin React, sin canvas, sin Electron.
// Los colores son fijos de tema claro para que la exportación no dependa del tema de la app.
import type { RelationshipModel } from '../../domain/diagram/model';
import {
  CORNER_RADIUS, firstSegment, headGeometry, headsOf, lastSegment, simplify, trimEnds,
  type HeadShape,
} from './canvas/edgePath';
import { EDGE_LABEL_H, estimateLabelWidth, placeEdgeLabels } from './edgeLabels';
import type { EdgePath, LayoutResult } from './types';

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
  /**
   * Relaciones del modelo (índice = `EdgePath.rel`): cabezas, multiplicidades, etiquetas y estilo. Sin
   * ellas cada arista usa las cabezas típicas de su tipo.
   */
  relationships?: readonly RelationshipModel[];
}

const CARD_FILL = '#ffffff';
const INK = '#454a62';
const PKG_STROKE = '#7d8297';
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
 * layout), aristas (path con esquinas redondeadas, discontinuas y cabezas como en el lienzo),
 * etiquetas de relación y multiplicidades (con fondo, encima de todo), notas (path con doblez +
 * líneas) y paquetes (rect + etiqueta). Devuelve el SVG y su tamaño en px.
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

  // Aristas: cuerpo (esquinas redondeadas, recortado donde empiezan las cabezas) y cabezas.
  const rels = opts?.relationships;
  const relOf = (e: EdgePath): RelationshipModel | undefined => (e.rel !== undefined ? rels?.[e.rel] : undefined);
  for (const e of layout.edges) {
    const pts = simplify(e.points);
    if (pts.length < 4) continue;
    const rel = relOf(e);
    const color = svgColor(rel?.style?.color) ?? INK;
    const heads = headsOf(rel ?? { type: e.type });
    const first = firstSegment(pts);
    const last = lastSegment(pts);
    const sh = first ? headGeometry(heads.source, ...first) : { inset: 0, shapes: [] };
    const th = last ? headGeometry(heads.target, ...last) : { inset: 0, shapes: [] };
    const body = trimEnds(pts, sh.inset, th.inset);
    const dashed = rel?.style?.dashed ?? (e.type === 'DEPENDENCY' || e.type === 'IMPLEMENTS');
    const width = rel?.style?.bold ? 3 : 1.5;
    const d = e.routing === 'orthogonal' ? roundedPath(body, X, Y) : straightPath(body, X, Y);
    out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="6 4"' : ''}/>`);
    for (const shape of [...sh.shapes, ...th.shapes]) out.push(headSvg(shape, color, X, Y));
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

  // Etiquetas y multiplicidades encima de todo, con fondo para que se lean sobre las líneas.
  const spots = placeEdgeLabels(
    layout,
    (e) => {
      const rel = relOf(e);
      const pts = simplify(e.points);
      const heads = headsOf(rel ?? { type: e.type });
      const first = firstSegment(pts);
      const last = lastSegment(pts);
      return {
        label: labelText(rel, e),
        source: rel?.sourceLabel,
        target: rel?.targetLabel,
        sourceInset: first ? headGeometry(heads.source, ...first).inset : 0,
        targetInset: last ? headGeometry(heads.target, ...last).inset : 0,
      };
    },
    estimateLabelWidth,
  );
  const labelBox = (text: string, x: number, y: number): void => {
    const w = estimateLabelWidth(text) + 4;
    out.push(`<rect x="${X(x - w / 2)}" y="${Y(y - EDGE_LABEL_H / 2)}" width="${num(w)}" height="${EDGE_LABEL_H}" fill="${LABEL_BG}"/>`);
    out.push(`<text x="${X(x)}" y="${Y(y)}" font-size="11" fill="#000000" text-anchor="middle" dominant-baseline="central">${escapeXml(text)}</text>`);
  };
  layout.edges.forEach((e, idx) => {
    const rel = relOf(e);
    const at = spots.get(idx);
    if (!at) return;
    if (rel?.sourceLabel && at.source) labelBox(rel.sourceLabel, at.source.x, at.source.y);
    if (rel?.targetLabel && at.target) labelBox(rel.targetLabel, at.target.x, at.target.y);
    const text = labelText(rel, e);
    if (text && at.label) labelBox(text, at.label.x, at.label.y);
  });

  out.push('</svg>');
  return { svg: out.join('\n'), width, height };
}

const LABEL_BG = '#ffffff';

/** Texto central de una relación, con la flecha de lectura si la tiene (igual que el lienzo). */
function labelText(rel: RelationshipModel | undefined, e: EdgePath): string | undefined {
  const text = rel?.label ?? e.label;
  if (!text) return undefined;
  return rel?.labelArrow === 'forward' ? text + ' ▶' : rel?.labelArrow === 'backward' ? '◀ ' + text : text;
}

/** Solo colores que SVG entiende sin el lienzo (hex o nombre CSS simple); el resto usa la tinta por defecto. */
function svgColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  return /^#[0-9a-fA-F]{3,8}$/.test(c) || /^[a-zA-Z]+$/.test(c) ? c : undefined;
}

function straightPath(points: readonly number[], X: (x: number) => string, Y: (y: number) => string): string {
  let d = `M ${X(points[0] ?? 0)} ${Y(points[1] ?? 0)}`;
  for (let i = 2; i + 1 < points.length; i += 2) d += ` L ${X(points[i] ?? 0)} ${Y(points[i + 1] ?? 0)}`;
  return d;
}

/** Igual que roundedCorners del lienzo: cada esquina es un arco tangente de radio limitado por sus tramos. */
function roundedPath(points: readonly number[], X: (x: number) => string, Y: (y: number) => string): string {
  const n = Math.floor(points.length / 2);
  let d = `M ${X(points[0] ?? 0)} ${Y(points[1] ?? 0)}`;
  for (let i = 1; i < n - 1; i++) {
    const px = points[(i - 1) * 2] ?? 0, py = points[(i - 1) * 2 + 1] ?? 0;
    const cx = points[i * 2] ?? 0, cy = points[i * 2 + 1] ?? 0;
    const nx = points[(i + 1) * 2] ?? 0, ny = points[(i + 1) * 2 + 1] ?? 0;
    const lin = Math.hypot(cx - px, cy - py);
    const lout = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(CORNER_RADIUS, lin / 2, lout / 2);
    if (r < 0.01) {
      d += ` L ${X(cx)} ${Y(cy)}`;
      continue;
    }
    const ax = cx - ((cx - px) / lin) * r, ay = cy - ((cy - py) / lin) * r;
    const bx = cx + ((nx - cx) / lout) * r, by = cy + ((ny - cy) / lout) * r;
    d += ` L ${X(ax)} ${Y(ay)} Q ${X(cx)} ${Y(cy)} ${X(bx)} ${Y(by)}`;
  }
  if (n >= 2) d += ` L ${X(points[n * 2 - 2] ?? 0)} ${Y(points[n * 2 - 1] ?? 0)}`;
  return d;
}

/** Cabeza de relación (flecha, triángulo, rombo, círculo...) con la misma geometría que el lienzo. */
function headSvg(s: HeadShape, color: string, X: (x: number) => string, Y: (y: number) => string): string {
  if (s.kind === 'circle') {
    return `<circle cx="${X(s.cx)}" cy="${Y(s.cy)}" r="${num(s.r)}" fill="${LABEL_BG}" stroke="${color}" stroke-width="1.5"/>`;
  }
  const pts: string[] = [];
  for (let i = 0; i + 1 < s.pts.length; i += 2) pts.push(`${X(s.pts[i] ?? 0)},${Y(s.pts[i + 1] ?? 0)}`);
  const fill = s.fill === 'line' ? color : s.fill === 'bg' ? LABEL_BG : 'none';
  const tag = s.closed ? 'polygon' : 'polyline';
  return `<${tag} points="${pts.join(' ')}" fill="${fill}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`;
}
