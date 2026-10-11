// src/presentation/diagram/palette/fuzzy.ts — búsqueda difusa de la paleta de comandos (T10, puro).
// Niveles: prefijo > subcadena en inicio de palabra > subcadena interior > subsecuencia. Sin mayúsculas
// ni acentos; los índices apuntan al texto ORIGINAL (para resaltar).

export interface FuzzyMatch {
  score: number;
  /** Índices del texto original que coinciden, en orden. */
  indices: number[];
}

export interface FuzzyResult<T> extends FuzzyMatch {
  item: T;
}

const TIER = 1000;

/** Una letra sin acento y en minúsculas ('' para marcas combinantes sueltas). */
function fold(ch: string): string {
  return ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().charAt(0);
}

function isAlnum(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** Inicio de palabra: principio, tras separador, salto camelCase o paso a dígito. */
function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  if (!isAlnum(prev)) return true;
  if (prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase()) return true;
  return /\d/.test(cur) && !/\d/.test(prev);
}

interface Folded { chars: string; orig: number[]; starts: boolean[] }

function foldText(text: string): Folded {
  let chars = '';
  const orig: number[] = [];
  const starts: boolean[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = fold(text[i]);
    if (!c) continue;
    chars += c;
    orig.push(i);
    starts.push(isWordStart(text, i));
  }
  return { chars, orig, starts };
}

function canMatch(t: string, q: string, from: number): boolean {
  let p = from;
  for (const c of q) {
    p = t.indexOf(c, p);
    if (p < 0) return false;
    p++;
  }
  return true;
}

function range(start: number, len: number): number[] {
  return Array.from({ length: len }, (_, k) => start + k);
}

/**
 * Con varias palabras cada una puntúa por su cuenta y cuenta la media ("export pdf" → "Exportar PDF"
 * casa por prefijo e inicio de palabra; juntas serían solo subsecuencia). Todas tienen que casar.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return matchWord(query, text);
  let score = 0;
  const indices = new Set<number>();
  for (const w of words) {
    const m = matchWord(w, text);
    if (!m) return null;
    score += m.score;
    for (const i of m.indices) indices.add(i);
  }
  return { score: Math.round(score / words.length), indices: [...indices].sort((a, b) => a - b) };
}

function matchWord(query: string, text: string): FuzzyMatch | null {
  const q = [...query].map(fold).join('').replace(/\s+/g, '');
  if (!q) return { score: 0, indices: [] };
  const f = foldText(text);
  const t = f.chars;
  const lengthBonus = TIER - 1 - Math.min(TIER - 1, t.length);
  const toOrig = (ix: number[]): number[] => ix.map((k) => f.orig[k]);

  if (t.startsWith(q)) return { score: 3 * TIER + lengthBonus, indices: toOrig(range(0, q.length)) };

  let first = -1;
  for (let p = t.indexOf(q); p >= 0; p = t.indexOf(q, p + 1)) {
    if (first < 0) first = p;
    if (f.starts[p]) return { score: 2 * TIER + lengthBonus, indices: toOrig(range(p, q.length)) };
  }
  if (first >= 0) return { score: TIER + lengthBonus, indices: toOrig(range(first, q.length)) };

  if (!canMatch(t, q, 0)) return null;
  // Subsecuencia: para cada letra, el primer inicio de palabra que deje casar el resto; si no, la primera.
  const ix: number[] = [];
  let p = 0;
  for (let i = 0; i < q.length; i++) {
    const rest = q.slice(i + 1);
    let pick = -1;
    for (let j = t.indexOf(q[i], p); j >= 0; j = t.indexOf(q[i], j + 1)) {
      if (!canMatch(t, rest, j + 1)) break;
      if (pick < 0) pick = j;
      if (f.starts[j]) { pick = j; break; }
    }
    ix.push(pick);
    p = pick + 1;
  }
  let bonus = 0;
  for (let k = 0; k < ix.length; k++) {
    if (f.starts[ix[k]]) bonus += 10;
    if (k > 0) bonus += ix[k] === ix[k - 1] + 1 ? 5 : -(ix[k] - ix[k - 1] - 1);
  }
  return { score: Math.max(0, Math.min(TIER - 1, TIER / 2 + bonus)), indices: toOrig(ix) };
}

/** Filtra y ordena: puntuación desc, etiqueta más corta, orden original (estable y determinista). */
export function fuzzySearch<T extends { label: string }>(query: string, items: readonly T[], limit = Infinity): FuzzyResult<T>[] {
  const out: (FuzzyResult<T> & { order: number })[] = [];
  items.forEach((item, order) => {
    const m = fuzzyMatch(query, item.label);
    if (m) out.push({ item, order, ...m });
  });
  const ranked = query.trim()
    ? out.sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length || a.order - b.order)
    : out;
  return ranked.slice(0, limit).map(({ item, score, indices }) => ({ item, score, indices }));
}
