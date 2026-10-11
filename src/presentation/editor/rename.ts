// Renombrar un tipo desde el lienzo (T7): reescribe el identificador y sus referencias en el texto.
// Usa el tokenizador del resaltado para saber qué es una referencia: no toca comentarios,
// cuerpos de nota, etiquetas de relación, nombres de campo ni identificadores que solo lo contienen.
import { StringStream } from '@codemirror/language';
import { pumlStreamParser } from './pumlLanguage';

/** Sustitución en columnas de una línea (1-based): vale igual para el archivo y para el editor (CRLF o LF). */
export interface LineEdit {
  line: number;
  from: number;
  to: number;
  insert: string;
}

const REFERENCE_STYLES = new Set(['typeName', 'variableName']);

/** Sustituciones que renombran `oldId` a `newId` en `text`. */
export function renameChanges(text: string, oldId: string, newId: string): LineEdit[] {
  const parser = pumlStreamParser;
  const state = parser.startState ? parser.startState(2) : null;
  if (state === null) return [];
  const edits: LineEdit[] = [];
  text.split(/\r\n|\r|\n/u).forEach((lineText, idx) => {
    const line = idx + 1;
    if (lineText.trim() === '') {
      parser.blankLine?.(state, 2);
      return;
    }
    const stream = new StringStream(lineText, 4, 2);
    while (!stream.eol()) {
      const style = parser.token(stream, state);
      const tok = stream.current();
      const at = stream.start;
      if (style !== null && REFERENCE_STYLES.has(style)) {
        if (tok === oldId) edits.push({ line, from: at, to: at + oldId.length, insert: newId });
        else if (tok.endsWith('.' + oldId)) edits.push({ line, from: at + tok.length - oldId.length, to: at + tok.length, insert: newId });
        else if (tok.startsWith(oldId + '::')) edits.push({ line, from: at, to: at + oldId.length, insert: newId });
      } else if (style === 'string' && tok === `"${oldId}"`) {
        edits.push({ line, from: at + 1, to: at + 1 + oldId.length, insert: newId });
      }
      stream.start = stream.pos;
    }
  });
  return edits;
}

/** Aplica las sustituciones a un texto conservando sus finales de línea. */
export function applyChanges(text: string, edits: readonly LineEdit[]): string {
  const parts = text.split(/(\r\n|\r|\n)/u);
  const byLine = new Map<number, LineEdit[]>();
  for (const e of edits) byLine.set(e.line, [...(byLine.get(e.line) ?? []), e]);
  for (const [line, list] of byLine) {
    const i = (line - 1) * 2;
    let s = parts[i];
    if (s === undefined) continue;
    for (const e of [...list].sort((a, b) => b.from - a.from)) s = s.slice(0, e.from) + e.insert + s.slice(e.to);
    parts[i] = s;
  }
  return parts.join('');
}
