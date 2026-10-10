import { describe, expect, it } from 'vitest';
import { combineSources, scanIncludes } from './include';

describe('scanIncludes', () => {
  it('detecta los 3 modos e ignora el ruido', () => {
    const text = [
      '@startuml',
      '!include b.puml',
      '!includeonce c.puml',
      '!include_many d.puml',
      '!define K 1',
      'class A',
      '!includesub x.puml!sub',
      '@enduml',
    ].join('\n');
    const dirs = scanIncludes(text);
    expect(dirs.map((d) => [d.mode, d.raw, d.line])).toEqual([
      ['include', 'b.puml', 2],
      ['once', 'c.puml', 3],
      ['many', 'd.puml', 4],
    ]);
  });

  it('acepta !include_once y es insensible a mayúsculas', () => {
    const dirs = scanIncludes('!INCLUDE_ONCE "sub/c.puml"\n!Include B.PUML');
    expect(dirs.map((d) => [d.mode, d.raw])).toEqual([
      ['once', 'sub/c.puml'],
      ['include', 'B.PUML'],
    ]);
  });
});

function memfs(files: Record<string, string>) {
  return {
    resolve: (from: string, raw: string): string => {
      // Resolución simple por nombre: el directorio se ignora en este stub.
      const base = raw.split('/').pop() ?? raw;
      void from;
      return `/mem/${base}`;
    },
    readFile: (abs: string): string | undefined => files[abs],
  };
}

describe('combineSources', () => {
  it('expande un include simple y mapea líneas', () => {
    const fs = memfs({
      '/mem/main.puml': '@startuml\n!include b.puml\nclass A\n@enduml',
      '/mem/b.puml': 'class B',
    });
    const r = combineSources('/mem/main.puml', fs.resolve, fs.readFile);
    expect(r.issues).toEqual([]);
    expect(r.text).toBe('@startuml\nclass B\nclass A\n@enduml');
    expect(r.files).toEqual(['/mem/main.puml', '/mem/b.puml']);
    // lineMap cubre todas las líneas del combinado.
    expect(r.lineMap).toHaveLength(4);
    expect(r.lineMap[1]).toEqual({ file: '/mem/b.puml', line: 1 });
    expect(r.lineMap[2]).toEqual({ file: '/mem/main.puml', line: 3 });
  });

  it('expande anidados y el diamante solo una vez', () => {
    const fs = memfs({
      '/mem/main.puml': '!include a.puml\n!include b.puml',
      '/mem/a.puml': '!include shared.puml\nclass A',
      '/mem/b.puml': '!include shared.puml\nclass B',
      '/mem/shared.puml': 'class S',
    });
    const r = combineSources('/mem/main.puml', fs.resolve, fs.readFile);
    expect(r.issues).toEqual([]);
    expect(r.text).toBe('class S\nclass A\nclass B');
    expect(r.files).toEqual(['/mem/main.puml', '/mem/a.puml', '/mem/shared.puml', '/mem/b.puml']);
  });

  it('detecta el ciclo A↔B con error y lo incluye una vez', () => {
    const fs = memfs({
      '/mem/a.puml': 'class A\n!include b.puml',
      '/mem/b.puml': 'class B\n!include a.puml',
    });
    const r = combineSources('/mem/a.puml', fs.resolve, fs.readFile);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].severity).toBe('error');
    expect(r.issues[0].message).toContain('Ciclo en !include:');
    expect(r.issues[0].message).toContain('→');
    expect(r.issues[0].file).toBe('/mem/b.puml');
    // El contenido de cada archivo aparece una sola vez.
    expect(r.text.match(/class A/g)).toHaveLength(1);
    expect(r.text.match(/class B/g)).toHaveLength(1);
  });

  it('corta por profundidad máxima y avisa el faltante sin tumbarse', () => {
    const chain: Record<string, string> = {};
    for (let i = 0; i < 25; i += 1) chain[`/mem/f${i}.puml`] = `!include f${i + 1}.puml`;
    chain['/mem/f25.puml'] = 'class Deep';
    const r1 = combineSources('/mem/f0.puml', memfs(chain).resolve, memfs(chain).readFile);
    expect(r1.issues.some((i) => i.severity === 'error' && i.message.includes('profundidad'))).toBe(true);

    const fs2 = memfs({ '/mem/main.puml': 'class A\n!include nope.puml\nclass B' });
    const r2 = combineSources('/mem/main.puml', fs2.resolve, fs2.readFile);
    expect(r2.issues).toHaveLength(1);
    expect(r2.issues[0]).toMatchObject({ severity: 'warning', file: '/mem/main.puml', line: 2 });
    expect(r2.issues[0].message).toContain('nope.puml');
    expect(r2.text).toBe('class A\nclass B');
  });

  it('!include_many duplica y lineMap es exacto en 2 archivos', () => {
    const fs = memfs({
      '/mem/main.puml': 'L1\n!include_many b.puml\nL3\n!include_many b.puml',
      '/mem/b.puml': 'X1\nX2',
    });
    const r = combineSources('/mem/main.puml', fs.resolve, fs.readFile);
    expect(r.text).toBe('L1\nX1\nX2\nL3\nX1\nX2');
    expect(r.lineMap).toEqual([
      { file: '/mem/main.puml', line: 1 },
      { file: '/mem/b.puml', line: 1 },
      { file: '/mem/b.puml', line: 2 },
      { file: '/mem/main.puml', line: 3 },
      { file: '/mem/b.puml', line: 1 },
      { file: '/mem/b.puml', line: 2 },
    ]);
  });

  it('omite @startuml/@enduml de los incluidos', () => {
    const fs = memfs({
      '/mem/main.puml': '@startuml\n!include b.puml\n@enduml',
      '/mem/b.puml': '@startuml\nclass B\n@enduml',
    });
    const r = combineSources('/mem/main.puml', fs.resolve, fs.readFile);
    expect(r.text).toBe('@startuml\nclass B\n@enduml');
  });
});
