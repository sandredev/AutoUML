// src/presentation/diagram/layout/cardModel.ts — filas, insignia y geometría de tarjeta estilo PlantUML (módulo puro).
// Lo usan el layout (para medir) y el dibujo (para pintar las mismas filas).
import type { ParameterModel, TypeNode } from '../../../domain/diagram/model';
import {
  CARD,
  FONTS,
  type Badge,
  type CardContent,
  type CardDisplay,
  DEFAULT_DISPLAY,
  type CardGeometry,
  type CardRow,
  type DetailOptions,
  type FontKey,
  type TextMeasurer,
} from '../style/contract';

const badgeColors: Record<Badge, string> = {
  C: '#ADD1B2',
  I: '#B4A7E5',
  E: '#EB937F',
  A: '#A9DCDF',
  R: '#E8D7A0',
  '@': '#E3664A',
  S: '#ADD1B2',
  X: '#D9D9D9',
  '?': '#D9D9D9',
};

export function badgeOf(t: TypeNode): Badge {
  if (t.declaredKind === 'interface') return 'I';
  if (t.declaredKind === 'enum') return 'E';
  if (t.declaredKind === 'annotation') return '@';
  if (t.declaredKind === 'record') return 'R';
  if (t.isAbstract || t.declaredKind === 'abstract') return 'A';
  if (t.isExternal) return 'X';
  if (t.implicit) return '?';
  return 'C';
}

export function badgeColor(b: Badge): string {
  return badgeColors[b];
}

/** Única implementación del formato de parámetros (antes duplicada en layout.ts y members.ts). */
export function fmtParams(ps: ParameterModel[], abbr?: number): string {
  if (abbr !== undefined) return '…' + abbr;
  return ps.map((p) => (p.name ? p.name + ': ' + p.type : p.type)).join(', ');
}

const accessorRe = /^(get|set|is)[A-Z]/;

function stereotypeOf(t: TypeNode): string {
  const list = [...t.stereotypes];
  if (t.isSealed && !list.includes('sealed')) list.unshift('sealed');
  return list.length > 0 ? '«' + list.join(', ') + '»' : '';
}

export function cardContentOf(
  t: TypeNode,
  detail: DetailOptions,
  summary: boolean,
  display: Readonly<CardDisplay> = DEFAULT_DISPLAY,
): CardContent {
  const badge = badgeOf(t);
  const italic = t.declaredKind === 'interface' || t.isAbstract || t.declaredKind === 'abstract';
  const base: Omit<CardContent, 'sections' | 'hiddenCount'> = {
    id: t.id,
    name: t.name,
    stereotype: display.showStereotype ? stereotypeOf(t) : '',
    badge,
    category: t.category,
    italic,
  };
  if (!display.showCircle) base.noBadge = true;
  if (summary) return { ...base, sections: [], hiddenCount: 0 };
  const vis = (v: CardRow['visibility']): string => (display.visibilityIcons ? v : '');
  const fields: CardRow[] = [];
  if (!display.hideFields) {
    for (const c of t.enumConstants) fields.push({ visibility: '', text: c, isStatic: false, isAbstract: false });
    for (const a of t.attributes) {
      const text = vis(a.visibility) + a.name + (a.type ? ': ' + a.type : '');
      fields.push({ visibility: a.visibility, text, isStatic: a.isStatic, isAbstract: false });
    }
  }
  const ops: CardRow[] = [];
  if (!display.hideMethods) {
    if (!detail.hideConstructors) {
      for (const c of t.constructors) {
        const text = '«create» ' + vis(c.visibility) + c.name + '(' + fmtParams(c.parameters, c.parametersAbbreviated) + ')';
        ops.push({ visibility: c.visibility, text, isStatic: false, isAbstract: false });
      }
    }
    for (const m of t.methods) {
      if (detail.hideAccessors && accessorRe.test(m.name)) continue;
      const ret = m.returnType ? ': ' + m.returnType : '';
      const text = vis(m.visibility) + m.name + '(' + fmtParams(m.parameters, m.parametersAbbreviated) + ')' + ret;
      ops.push({ visibility: m.visibility, text, isStatic: m.isStatic, isAbstract: m.isAbstract });
    }
  }
  let budget = Math.max(0, detail.maxRows);
  const s1 = fields.slice(0, budget);
  budget -= s1.length;
  const s2 = ops.slice(0, budget);
  const hiddenCount = fields.length + ops.length - s1.length - s2.length;
  // Un compartimento vacío se muestra solo si ni el detalle ni hide empty lo ocultan; "hide fields"/
  // "hide methods" lo quitan siempre.
  const sections: CardRow[][] = [];
  const keepEmptyFields = !detail.hideEmptyCompartments && !display.hideEmptyFields && !display.hideFields;
  const keepEmptyOps = !detail.hideEmptyCompartments && !display.hideEmptyMethods && !display.hideMethods;
  if (s1.length > 0 || keepEmptyFields) sections.push(s1);
  if (s2.length > 0 || keepEmptyOps) sections.push(s2);
  return { ...base, sections, hiddenCount };
}

/** Plantilla por defecto del aviso de filas ocultas; {n} = número (se traduce con labels.moreMembers). */
export const MORE_TEMPLATE = '… +{n} más';

export function moreText(n: number, template: string = MORE_TEMPLATE): string {
  return template.split('{n}').join(String(n));
}

export function geometryOf(c: CardContent): CardGeometry {
  const headerH = c.stereotype ? CARD.headerHStereo : CARD.headerH;
  const sectionH = c.sections.map((rows) => rows.length * CARD.rowH + 2 * CARD.sectionPadY);
  const hasMoreRow = c.hiddenCount > 0;
  if (hasMoreRow) {
    if (sectionH.length === 0) sectionH.push(2 * CARD.sectionPadY);
    const last = sectionH.length - 1;
    sectionH[last] = (sectionH[last] ?? 0) + CARD.rowH;
  }
  return { headerH, sectionH, hasMoreRow };
}

export function heightOf(g: CardGeometry): number {
  let h = g.headerH;
  for (const s of g.sectionH) h += s;
  return h;
}

export function measureCardBox(
  c: CardContent,
  m: TextMeasurer,
  moreTemplate: string = MORE_TEMPLATE,
): { w: number; h: number; geometry: CardGeometry } {
  const geometry = geometryOf(c);
  const nameW = m(c.name, c.italic ? 'nameItalic' : 'name');
  const headLeft = c.noBadge ? CARD.padX : CARD.padX + CARD.badgeD + 6;
  let w = Math.max(CARD.minW, headLeft * 2 + nameW);
  if (c.stereotype) w = Math.max(w, headLeft * 2 + m(c.stereotype, 'stereo'));
  for (const rows of c.sections) {
    for (const r of rows) w = Math.max(w, 2 * CARD.padX + m(r.text, r.isAbstract ? 'rowItalic' : 'row'));
  }
  if (c.hiddenCount > 0) w = Math.max(w, 2 * CARD.padX + m(moreText(c.hiddenCount, moreTemplate), 'rowItalic'));
  return { w: Math.ceil(w), h: heightOf(geometry), geometry };
}

function fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 12;
}

function charW(c: string): number {
  if ('iljI.,:;|!\'()[] '.includes(c)) return 0.32;
  if ('mwMW@%«»'.includes(c)) return 0.88;
  if (c >= 'A' && c <= 'Z') return 0.7;
  return 0.6;
}

export function estimateWidth(text: string, font: string): number {
  const size = fontPx(font);
  const bold = font.startsWith('bold') ? 1.08 : 1;
  let w = 0;
  for (const c of text) w += charW(c);
  return w * size * bold;
}

export function makeMeasurer(): TextMeasurer {
  const cache = new Map<string, number>();
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    } catch {
      ctx = null;
    }
  }
  return (text: string, font: FontKey): number => {
    const k = font + ' ' + text;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    let w: number;
    if (ctx) {
      ctx.font = FONTS[font];
      w = ctx.measureText(text).width;
    } else {
      w = estimateWidth(text, FONTS[font]);
    }
    cache.set(k, w);
    return w;
  };
}
