import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { issuesToDiagnostics } from '../../../src/presentation/editor/diagnostics';

const doc = (s: string): Text => Text.of(s.split(/\r\n|\r|\n/u));
const TEXT = '@startuml\n  class A {\n???\n\n@enduml';
const DOC = doc(TEXT);

describe('issuesToDiagnostics', () => {
  it('subraya la línea del issue sin la sangría', () => {
    const [d] = issuesToDiagnostics(DOC, [{ line: 2, severity: 'error', message: 'Llave sin cerrar' }], 'main.puml');
    expect(d).toEqual({ from: 12, to: 21, severity: 'error', message: 'Llave sin cerrar' });
    expect(DOC.sliceString(d?.from ?? 0, d?.to)).toBe('class A {');
  });

  it('conserva la severidad de los avisos', () => {
    const [d] = issuesToDiagnostics(DOC, [{ line: 3, severity: 'warning', message: 'Línea no reconocida' }], null);
    expect(d).toMatchObject({ severity: 'warning' });
    expect(DOC.sliceString(d?.from ?? 0, d?.to)).toBe('???');
  });

  it('en una línea vacía el diagnóstico tiene longitud cero en su inicio', () => {
    const [d] = issuesToDiagnostics(DOC, [{ line: 4, severity: 'warning', message: 'x' }], null);
    expect(d).toMatchObject({ from: 26, to: 26 });
  });

  it('ignora los issues de los archivos incluidos', () => {
    const issues = [
      { line: 1, severity: 'warning' as const, message: 'del incluido', file: 'c:/p/inc.iuml' },
      { line: 3, severity: 'warning' as const, message: 'de la entrada', file: 'c:/p/main.puml' },
    ];
    expect(issuesToDiagnostics(DOC, issues, 'c:/p/main.puml').map((d) => d.message)).toEqual(['de la entrada']);
  });

  it('un issue sin archivo es de la entrada', () => {
    expect(issuesToDiagnostics(DOC, [{ line: 1, severity: 'error', message: 'e' }], 'c:/p/main.puml')).toHaveLength(1);
  });

  it('descarta las líneas que ya no existen (el texto cambió desde el parseo)', () => {
    expect(issuesToDiagnostics(DOC, [{ line: 40, severity: 'error', message: 'e' }], null)).toEqual([]);
    expect(issuesToDiagnostics(DOC, [{ line: 0, severity: 'error', message: 'e' }], null)).toEqual([]);
  });

  it('con CRLF el salto cuenta como un carácter (posiciones del editor, no del archivo)', () => {
    const [d] = issuesToDiagnostics(doc('a\r\nbb\r\nc'), [{ line: 2, severity: 'error', message: 'e' }], null);
    expect(d).toMatchObject({ from: 2, to: 4 });
  });
});
