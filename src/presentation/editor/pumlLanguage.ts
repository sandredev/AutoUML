// Resaltado PlantUML para CodeMirror 6 (T7): StreamLanguage propio, sin gramática Lezer.
// Las palabras clave, flechas, notas y directivas se reconocen con las MISMAS regex del parser
// (PUML_SYNTAX), así el editor no colorea como válido algo que el parser rechaza.
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser, type StringStream } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { PUML_SYNTAX } from '../../application/puml/parser';

/** Qué se está escribiendo en la línea en curso; decide el estilo de identificadores y de ":". */
type LineKind = 'start' | 'type-header' | 'package' | 'relation' | 'member' | 'other';

export interface PumlState {
  /** Dentro del cuerpo de una nota de varias líneas (hasta "end note"). */
  inNote: boolean;
  /** La cabecera de la línea actual abre una nota: el cuerpo empieza en la línea siguiente. */
  noteNext: boolean;
  /** Dentro de un comentario de bloque /' … '/. */
  inBlockComment: boolean;
  /** Llaves abiertas: 'type' si es el cuerpo de un tipo (sus líneas son miembros). */
  braces: ('type' | 'other')[];
  line: LineKind;
  /** Ya pasó el ":" de la línea (etiqueta de relación o tipo de un miembro). */
  afterColon: boolean;
  /** En una línea de miembro, ya apareció el nombre (lo siguiente no es visibilidad). */
  sawName: boolean;
}

const RE_PACKAGE_START = /^(?:package|namespace)\b/iu;
const RE_DIRECTION = /^(?:left\s+to\s+right|top\s+to\s+bottom)\s+direction\b/iu;
const RE_MODIFIER = /^\{\s*(?:static|abstract|classifier)\s*\}/u;
const RE_IDENT = /^[\p{L}_$][\p{L}\p{N}_$.]*(?:::[\p{L}\p{N}_$]+)?/u;
const RE_COLOR = /^#[^\s{}<]+/u;
const RE_WORD = /^\S+/u;
const KEYWORDS = new Set(['extends', 'implements', 'as', 'class', 'interface', 'enum']);

function newLine(state: PumlState): void {
  if (state.noteNext) {
    state.noteNext = false;
    state.inNote = true;
  }
  state.line = 'start';
  state.afterColon = false;
  state.sawName = false;
}

/** Primer token de la línea: decide de qué clase de línea se trata. */
function lineStart(stream: StringStream, state: PumlState): string | null {
  const rest = stream.string.slice(stream.pos);
  if (state.braces.at(-1) === 'type') {
    state.line = 'member';
    return null;
  }
  if (PUML_SYNTAX.noteStart.test(rest)) {
    // "note … : texto" y 'note "texto" as N' son de una línea; el resto sigue hasta "end note".
    state.noteNext = !rest.includes(':') && !/^note\s+"/iu.test(rest);
    state.line = 'other';
    stream.match(/^note\b/iu);
    return 'keyword';
  }
  if (PUML_SYNTAX.directive.test(rest)) {
    state.line = 'other';
    if (rest.startsWith('@')) {
      stream.match(/^@\w+/u);
      return 'meta';
    }
    if (rest.startsWith('!')) {
      stream.skipToEnd();
      return 'meta';
    }
    if (stream.match(RE_DIRECTION)) return 'keyword';
    stream.match(/^\w+/u);
    return 'keyword';
  }
  if (PUML_SYNTAX.typeStart.test(rest)) {
    state.line = 'type-header';
    stream.match(/^\w+/u);
    return 'keyword';
  }
  if (RE_PACKAGE_START.test(rest)) {
    state.line = 'package';
    stream.match(/^\w+/u);
    return 'keyword';
  }
  state.line = 'relation';
  return null;
}

export const pumlStreamParser: StreamParser<PumlState> = {
  name: 'plantuml',
  startState: () => ({
    inNote: false,
    noteNext: false,
    inBlockComment: false,
    braces: [],
    line: 'start',
    afterColon: false,
    sawName: false,
  }),
  copyState: (s) => ({ ...s, braces: [...s.braces] }),
  blankLine: (state) => newLine(state),

  token(stream, state) {
    if (stream.sol()) newLine(state);

    if (state.inBlockComment) {
      if (stream.skipTo("'/")) {
        stream.pos += 2;
        state.inBlockComment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;

    if (state.inNote) {
      const end = PUML_SYNTAX.noteEnd.test(stream.string.slice(stream.pos));
      if (end) state.inNote = false;
      stream.skipToEnd();
      return end ? 'keyword' : 'string';
    }

    if (stream.match("/'")) {
      if (stream.skipTo("'/")) stream.pos += 2;
      else {
        stream.skipToEnd();
        state.inBlockComment = true;
      }
      return 'comment';
    }

    if (state.line === 'start') {
      if (stream.peek() === "'") {
        stream.skipToEnd();
        return 'comment';
      }
      const style = lineStart(stream, state);
      if (style !== null) return style;
    }

    // Etiqueta de una relación: el resto de la línea es texto libre.
    if (state.afterColon && state.line !== 'member') {
      stream.skipToEnd();
      return 'string';
    }

    if (stream.match(RE_MODIFIER)) return 'modifier';
    if (state.line === 'member' && !state.sawName && stream.match(/^[+\-#~]/u)) return 'operator';
    if (stream.match(/^"[^"]*"?/u)) return 'string';
    if (stream.match(/^<<[^>]*>>/u)) return 'meta';

    const ch = stream.peek();
    if (ch === '{') {
      stream.next();
      state.braces.push(state.line === 'type-header' ? 'type' : 'other');
      return 'brace';
    }
    if (ch === '}') {
      stream.next();
      state.braces.pop();
      return 'brace';
    }
    if (ch === ':') {
      stream.next();
      state.afterColon = true;
      return 'punctuation';
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      stream.next();
      return 'punctuation';
    }

    // Flecha: palabra entera que el parser reconoce como flecha (en un miembro, "-" es visibilidad).
    if (state.line !== 'member') {
      const word = stream.match(RE_WORD, false);
      if (typeof word === 'object' && word !== null && PUML_SYNTAX.arrow.test(word[0])) {
        stream.match(RE_WORD);
        return 'operator';
      }
    }
    if (stream.match(RE_COLOR)) return 'atom';
    if (stream.match(/^\d+(?:\.\d+)?/u)) return 'number';

    const ident = stream.match(RE_IDENT);
    if (ident) {
      if (KEYWORDS.has(stream.current())) return 'keyword';
      if (state.line === 'member') {
        if (state.afterColon) return 'typeName';
        state.sawName = true;
        return 'propertyName';
      }
      return state.line === 'other' ? 'variableName' : 'typeName';
    }

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "'", block: { open: "/'", close: "'/" } },
  },
};

export const pumlLanguage = StreamLanguage.define(pumlStreamParser);

/** Colores del resaltado: variables CSS del tema de la app (claro/oscuro/alto contraste). */
export const pumlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--syn-type)' },
  { tag: tags.propertyName, color: 'var(--syn-property)' },
  { tag: tags.variableName, color: 'var(--syn-variable)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--syn-meta)' },
  { tag: tags.operator, color: 'var(--syn-operator)', fontWeight: '600' },
  { tag: tags.atom, color: 'var(--syn-atom)' },
  { tag: tags.number, color: 'var(--syn-atom)' },
  { tag: tags.modifier, color: 'var(--syn-meta)', fontStyle: 'italic' },
  { tag: [tags.brace, tags.punctuation], color: 'var(--syn-punct)' },
]);

/** Soporte PlantUML completo: lenguaje + resaltado. */
export function plantuml(): Extension {
  return [pumlLanguage, syntaxHighlighting(pumlHighlightStyle)];
}
