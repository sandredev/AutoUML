// src/render/layout/members.ts — compartimentos de una tarjeta UML al estilo PlantUML (puro).
// Lo usan el layout (para medir) y el dibujo (para pintar): así ambos coinciden siempre.
import type { ParameterModel, TypeNode, Visibility } from '../../core/model';

/** Alto de la cabecera (icono + nombre). */
export const HEADER_H = 30;
/** Alto de cada fila de miembro. */
export const ROW_H = 16;
/** Margen vertical dentro de un compartimento con filas. */
export const COMP_PAD = 4;
/** Alto de un compartimento vacío (PlantUML lo dibuja igual, como una franja fina). */
export const EMPTY_COMP_H = 8;
/** Máximo de filas visibles por tarjeta (entre los dos compartimentos). */
export const MAX_ROWS = 40;
/** Alto de una tarjeta en modo resumen (solo cabecera). */
export const SUMMARY_H = 32;

export interface MemberRow {
  /** Texto sin el símbolo de visibilidad (se dibuja como icono). */
  text: string;
  /** undefined en constantes de enum (no llevan icono). */
  vis?: Visibility;
  /** Atributo (icono hueco) o método/constructor (icono relleno). */
  kind: 'field' | 'method';
  isStatic: boolean;
  isAbstract: boolean;
}

export interface MemberSections {
  /** Compartimento 1: constantes de enum + atributos. */
  fields: MemberRow[];
  /** Compartimento 2: constructores + métodos. */
  methods: MemberRow[];
  /** Filas que no caben (se muestra "… +N más" al final del último compartimento con filas). */
  hidden: number;
}

function fmtParams(ps: ParameterModel[], abbr?: number): string {
  if (abbr !== undefined) return `…${abbr}`;
  return ps.map((p) => (p.name ? `${p.name}: ${p.type}` : p.type)).join(', ');
}

const cache = new WeakMap<TypeNode, MemberSections>();

/** Filas de cada compartimento, ya recortadas a MAX_ROWS en total. */
export function memberSections(node: TypeNode): MemberSections {
  const hit = cache.get(node);
  if (hit) return hit;
  const fields: MemberRow[] = [];
  for (const c of node.enumConstants) fields.push({ text: c, kind: 'field', isStatic: false, isAbstract: false });
  for (const a of node.attributes) {
    fields.push({ text: `${a.name}${a.type ? `: ${a.type}` : ''}`, vis: a.visibility, kind: 'field', isStatic: a.isStatic, isAbstract: false });
  }
  const methods: MemberRow[] = [];
  for (const c of node.constructors) {
    methods.push({ text: `${c.name}(${fmtParams(c.parameters, c.parametersAbbreviated)})`, vis: c.visibility, kind: 'method', isStatic: false, isAbstract: false });
  }
  for (const m of node.methods) {
    methods.push({
      text: `${m.name}(${fmtParams(m.parameters, m.parametersAbbreviated)})${m.returnType ? `: ${m.returnType}` : ''}`,
      vis: m.visibility,
      kind: 'method',
      isStatic: m.isStatic,
      isAbstract: m.isAbstract,
    });
  }
  const total = fields.length + methods.length;
  let out: MemberSections;
  if (total <= MAX_ROWS) {
    out = { fields, methods, hidden: 0 };
  } else {
    const f = fields.slice(0, MAX_ROWS);
    const m = methods.slice(0, Math.max(0, MAX_ROWS - f.length));
    out = { fields: f, methods: m, hidden: total - f.length - m.length };
  }
  cache.set(node, out);
  return out;
}

/** Alto de un compartimento con n filas. */
export function compartmentH(rows: number): number {
  return rows > 0 ? rows * ROW_H + COMP_PAD * 2 : EMPTY_COMP_H;
}

/** Filas efectivas de cada compartimento contando la fila "… +N más" (va en el de métodos). */
export function compartmentRows(s: MemberSections): { fields: number; methods: number } {
  return { fields: s.fields.length, methods: s.methods.length + (s.hidden > 0 ? 1 : 0) };
}

/** Alto total de la tarjeta (cabecera + dos compartimentos). */
export function cardHeight(node: TypeNode, summary: boolean): number {
  if (summary) return SUMMARY_H;
  const r = compartmentRows(memberSections(node));
  return HEADER_H + compartmentH(r.fields) + compartmentH(r.methods);
}
