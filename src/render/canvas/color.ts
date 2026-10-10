// src/render/canvas/color.ts — colores por clase (#hex o nombres CSS) y contraste del texto.

/** "#LightBlue" → "LightBlue", "##[dashed]red" → "red", "line:red" → "red", "#F0F0F0" se conserva. */
export function cleanColor(raw?: string): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().replace(/^line:/i, '').replace(/\[[^\]]*\]/g, '').replace(/^#+/, '#');
  if (s.startsWith('#')) {
    const b = s.slice(1);
    s = /^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(b) ? '#' + b : b;
  }
  return s || undefined;
}

export function parseRgb(css: string): [number, number, number] | null {
  const h = /^#([0-9a-f]{6})/i.exec(css);
  if (h) {
    const v = parseInt(h[1] ?? '0', 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Luminancia relativa WCAG. */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const resolved = new Map<string, string | null>();

/** Normaliza un color con el propio canvas (acepta cualquier nombre CSS). null si no es válido. */
export function resolveColor(ctx: CanvasRenderingContext2D, raw?: string): string | null {
  const c = cleanColor(raw);
  if (!c) return null;
  const hit = resolved.get(c);
  if (hit !== undefined) return hit;
  const prev = ctx.fillStyle;
  ctx.fillStyle = '#010203';
  ctx.fillStyle = c;
  const out = String(ctx.fillStyle);
  ctx.fillStyle = prev;
  const ok = out !== '#010203' || c.toLowerCase() === '#010203' ? out : null;
  resolved.set(c, ok);
  return ok;
}

/** Texto negro o blanco según el fondo. */
export function textOn(bg: string, dark = '#000000', light = '#ffffff'): string {
  const rgb = parseRgb(bg);
  if (!rgb) return dark;
  return luminance(rgb) > 0.4 ? dark : light;
}
