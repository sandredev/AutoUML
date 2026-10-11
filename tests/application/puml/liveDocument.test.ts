import { describe, expect, it } from 'vitest';
import { hasBlockingErrors, nextLiveState, parseDocument, reconcileDiskText } from '../../../src/application/puml/liveDocument';

const VALID = '@startuml\nclass A\nclass B\nA --> B\n@enduml';
const VALID_2 = '@startuml\nclass A\nclass B\nclass C\nA --> B\n@enduml';
// Llave sin cerrar: error grave (el cuerpo se traga el resto del texto).
const BROKEN = '@startuml\nclass A {\nclass B\n@enduml';
// Solo avisos: una línea que el parser no reconoce.
const WARNING_ONLY = '@startuml\nclass A\n???\n@enduml';

describe('parseDocument', () => {
  it('sin mapa de líneas devuelve el modelo tal cual', () => {
    const model = parseDocument(VALID);
    expect(model.types.map((t) => t.id)).toEqual(['A', 'B']);
    expect(model.issues).toEqual([]);
  });

  it('con !include remapea los issues a archivo y línea de origen y guarda la línea combinada', () => {
    const combined = '@startuml\nclass A\n???\n@enduml';
    const lineMap = [
      { file: 'main.puml', line: 1 },
      { file: 'inc.iuml', line: 1 },
      { file: 'inc.iuml', line: 2 },
      { file: 'main.puml', line: 3 },
    ];
    const model = parseDocument(combined, { lineMap, loadIssues: [] });
    expect(model.issues).toEqual([
      expect.objectContaining({ file: 'inc.iuml', line: 2, combinedLine: 3, severity: 'warning' }),
    ]);
  });

  it('los avisos de la carga (incluidos que faltan) van primero', () => {
    const loadIssues = [{ file: 'main.puml', line: 2, severity: 'warning' as const, message: 'falta x.iuml' }];
    const model = parseDocument(VALID, { lineMap: [], loadIssues });
    expect(model.issues[0]).toEqual({ file: 'main.puml', line: 2, severity: 'warning', message: 'falta x.iuml' });
  });
});

describe('hasBlockingErrors', () => {
  it('solo los errores (no los avisos) impiden mostrar el diagrama nuevo', () => {
    expect(hasBlockingErrors(parseDocument(VALID))).toBe(false);
    expect(hasBlockingErrors(parseDocument(WARNING_ONLY))).toBe(false);
    expect(hasBlockingErrors(parseDocument(BROKEN))).toBe(true);
  });
});

describe('nextLiveState: conservación del último modelo válido', () => {
  it('un modelo sin errores se muestra', () => {
    const parsed = parseDocument(VALID);
    const state = nextLiveState(null, parsed);
    expect(state.shown).toBe(parsed);
    expect(state.issues).toBe(parsed.issues);
    expect(state.stale).toBe(false);
  });

  it('con errores graves se mantiene el último diagrama válido y se muestran los errores nuevos', () => {
    const good = nextLiveState(null, parseDocument(VALID));
    const broken = parseDocument(BROKEN);
    const state = nextLiveState(good, broken);
    expect(state.shown).toBe(good.shown);
    expect(state.issues).toBe(broken.issues);
    expect(state.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(state.stale).toBe(true);
  });

  it('varios errores seguidos siguen mostrando el mismo modelo válido (no el último roto)', () => {
    const good = nextLiveState(null, parseDocument(VALID));
    const once = nextLiveState(good, parseDocument(BROKEN));
    const twice = nextLiveState(once, parseDocument(BROKEN + '\nclass Z {'));
    expect(twice.shown).toBe(good.shown);
    expect(twice.stale).toBe(true);
  });

  it('al corregir el error se muestra el modelo nuevo', () => {
    const good = nextLiveState(null, parseDocument(VALID));
    const broken = nextLiveState(good, parseDocument(BROKEN));
    const fixed = parseDocument(VALID_2);
    const state = nextLiveState(broken, fixed);
    expect(state.shown).toBe(fixed);
    expect(state.stale).toBe(false);
  });

  it('los avisos no bloquean: el modelo con avisos sustituye al anterior', () => {
    const good = nextLiveState(null, parseDocument(VALID));
    const warned = parseDocument(WARNING_ONLY);
    expect(nextLiveState(good, warned).shown).toBe(warned);
  });

  it('sin modelo anterior se muestra lo que haya aunque tenga errores (mejor algo que nada)', () => {
    const broken = parseDocument(BROKEN);
    const state = nextLiveState(null, broken);
    expect(state.shown).toBe(broken);
    expect(state.stale).toBe(false);
  });
});

describe('reconcileDiskText: el archivo cambió en disco', () => {
  it('si coincide con el editor no hay nada que hacer (p. ej. el eco de nuestro propio guardado)', () => {
    expect(reconcileDiskText({ editorText: 'x', savedText: 'old', diskText: 'x' })).toBe('in-sync');
  });

  it('sin cambios sin guardar el editor toma el texto del disco', () => {
    expect(reconcileDiskText({ editorText: 'a', savedText: 'a', diskText: 'b' })).toBe('replace');
  });

  it('con cambios sin guardar no se pisan: conflicto', () => {
    expect(reconcileDiskText({ editorText: 'mine', savedText: 'a', diskText: 'theirs' })).toBe('conflict');
  });
});
