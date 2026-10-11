import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { docText, eolOf } from '../../../src/presentation/editor/eol';

describe('fin de línea del editor', () => {
  it('detecta CRLF; si no, LF', () => {
    expect(eolOf('a\r\nb')).toBe('\r\n');
    expect(eolOf('a\nb')).toBe('\n');
    expect(eolOf('una sola línea')).toBe('\n');
  });

  it('un archivo CRLF sale igual que entró (sin cambios no hay "sin guardar")', () => {
    const text = '@startuml\r\nclass A\r\n@enduml\r\n';
    const state = EditorState.create({ doc: text });
    expect(docText(state.doc, eolOf(text))).toBe(text);
  });

  it('lo pegado con LF en un archivo CRLF son líneas de verdad y se guardan con CRLF', () => {
    const text = '@startuml\r\n@enduml';
    const state = EditorState.create({ doc: text });
    const pasted = state.update({ changes: { from: 'startuml'.length + 1, insert: '\nclass A\nclass B' } }).state;
    expect(pasted.doc.lines).toBe(4);
    expect(docText(pasted.doc, eolOf(text))).toBe('@startuml\r\nclass A\r\nclass B\r\n@enduml');
  });

  it('un archivo LF sigue en LF aunque se pegue CRLF', () => {
    const text = 'a\nb';
    const state = EditorState.create({ doc: text });
    const pasted = state.update({ changes: { from: 1, insert: '\r\nx' } }).state;
    expect(docText(pasted.doc, eolOf(text))).toBe('a\nx\nb');
  });
});
