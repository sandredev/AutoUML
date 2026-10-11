// Fin de línea en el editor (T7). CodeMirror parte el texto por cualquier fin de línea y lo une con "\n";
// el archivo conserva el suyo: el texto que sale del editor (cambios, guardar) se rehace con el original.
import type { Text } from '@codemirror/state';

/** CRLF si el texto lo usa; si no, LF. */
export function eolOf(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Texto del documento con el fin de línea del archivo. */
export function docText(doc: Text, eol: string): string {
  return doc.sliceString(0, doc.length, eol);
}
