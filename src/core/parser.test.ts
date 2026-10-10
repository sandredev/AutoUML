import { describe, expect, it } from 'vitest';
import { parsePuml } from './parser';
import { validatePuml } from './validate';
import { EJEMPLO } from './fixtures';

describe('parsePuml', () => {
  it('parsea el ejemplo de FORMATO-PUML', () => {
    const m = parsePuml(EJEMPLO);
    expect(m.issues).toEqual([]);
    expect(m.summaryMode).toBe(true);
    const persona = m.types.find((t) => t.id === 'Persona');
    expect(persona?.constructors).toHaveLength(1);
    expect(persona?.methods.find((x) => x.name === 'calcular')?.isAbstract).toBe(true);
    expect(persona?.methods.find((x) => x.name === 'contador')?.isStatic).toBe(true);
    const est = m.types.find((t) => t.id === 'Estudiante');
    expect(est?.methods.find((x) => x.name === 'mapa')?.parameters).toHaveLength(2);
    expect(est?.methods.find((x) => x.name === 'muchos')?.parametersAbbreviated).toBe(7);
    expect(m.types.find((t) => t.id === 'EstadoEstudiante')?.enumConstants).toEqual(['ACTIVO', 'RETIRADO', 'GRADUADO']);
    const ext = m.relationships.find((r) => r.type === 'EXTENDS');
    expect(ext).toMatchObject({ source: 'Estudiante', target: 'Persona' });
    expect(m.relationships.filter((r) => r.type === 'IMPLEMENTS').every((r) => r.source === 'Estudiante')).toBe(true);
    expect(m.relationships).toHaveLength(7);
    expect(m.types.some((t) => t.implicit)).toBe(false);
  });

  it('sealed en cabecera y en cuerpo; non-sealed no cuenta', () => {
    const m = parsePuml(`@startuml
interface Forma <<sealed>> {}
class Figura {
  <<sealed>>
}
class Libre <<non-sealed>>
@enduml`);
    expect(m.types.map((t) => [t.id, t.category])).toEqual([
      ['Forma', 'sealed'],
      ['Figura', 'sealed'],
      ['Libre', 'class'],
    ]);
  });

  it('homónimos con alias y extremo no declarado', () => {
    const m = parsePuml(`@startuml
package "a" as pkg_a {
  class "Foo" as a_Foo
}
package "b" as pkg_b {
  class "Foo" as b_Foo
}
a_Foo --> b_Foo : usa
b_Foo --> Object
@enduml`);
    expect(m.types.filter((t) => t.name === 'Foo').map((t) => t.packageName)).toEqual(['a', 'b']);
    expect(m.relationships[0]).toMatchObject({ source: 'a_Foo', target: 'b_Foo', label: 'usa' });
    const obj = m.types.find((t) => t.id === 'Object');
    expect(obj?.implicit).toBe(true);
    expect(obj?.category).toBe('undeclared');
  });

  it('paquetes por capas', () => {
    const m = parsePuml(`@startuml
package "layer" as layer_0 {
  package "x.cli" as pkg_x_cli {
    class Main
  }
}
class Suelta
@enduml`);
    expect(m.packages.find((p) => p.name === 'x.cli')).toEqual({ name: 'x.cli', typeIds: ['Main'], layer: 'layer' });
    expect(m.packages.some((p) => p.name === 'layer')).toBe(false);
    expect(m.types.find((t) => t.id === 'Suelta')?.packageName).toBe('(default package)');
  });

  it('línea mala genera issue con número de línea y el resto parsea', () => {
    const m = parsePuml(`@startuml
class A {
  + ???mal(
}
esto no vale nada
class B
@enduml`);
    expect(m.issues.map((i) => i.line)).toEqual([3, 5]);
    expect(m.types.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('llave sin cerrar genera issue', () => {
    const m = parsePuml('@startuml\nclass A {\n+ x: int\n@enduml');
    expect(m.issues.some((i) => i.severity === 'error' && i.line === 2)).toBe(true);
  });

  it('soporta BOM, CRLF y tabs', () => {
    const m = parsePuml('﻿@startuml\r\n\tclass Estudiánte {\r\n\t\t- nombre: String\r\n\t}\r\n@enduml\r\n');
    expect(m.issues).toEqual([]);
    expect(m.types[0]?.name).toBe('Estudiánte');
  });

  it('1000 tipos y 2000 relaciones en < 1 s', () => {
    const out: string[] = ['@startuml', 'package "x.big" as pkg_x_big {'];
    for (let i = 0; i < 1000; i++) {
      const kw = i % 10 === 0 ? 'enum' : i % 10 === 1 ? 'record' : i % 10 === 2 ? 'interface' : 'class';
      out.push(`${kw} T${i} {`, i % 10 === 3 ? '<<sealed>>' : '', i % 10 === 0 ? 'A' : '- f: Map<String, Integer>', '}');
    }
    out.push('}');
    for (let i = 0; i < 2000; i++) out.push(`T${i % 1000} ${i % 2 ? '-->' : '..>'} T${(i * 7 + 1) % 1000}`);
    out.push('@enduml');
    const src = out.join('\n');
    const t0 = performance.now();
    const m = parsePuml(src);
    const dt = performance.now() - t0;
    expect(m.types).toHaveLength(1000);
    expect(m.relationships).toHaveLength(2000);
    expect(dt).toBeLessThan(1000);
  });
});

describe('validatePuml', () => {
  it('detecta faltantes, orden invertido, vacío y nulos', () => {
    expect(validatePuml('')).toHaveLength(1);
    expect(validatePuml('class A').map((i) => i.message)).toHaveLength(2);
    expect(validatePuml('@enduml\n@startuml').some((i) => i.message.includes('antes'))).toBe(true);
    expect(validatePuml('@startuml\n\u0000\n@enduml')).toHaveLength(1);
    expect(validatePuml('@startuml\n@enduml')).toEqual([]);
  });
});

describe('parsePuml — T1', () => {
  it('1. nota flotante de una línea no descarta el resto', () => {
    const m = parsePuml(`@startuml\nnote "floating" as N1\nenum Color {\n  RED\n  GREEN\n}\nabstract class Shape\nclass Circle extends Shape\n@enduml`);
    expect(m.types.map((t) => t.id)).toEqual(['Color', 'Shape', 'Circle']);
    expect(m.relationships[0]).toMatchObject({ source: 'Circle', target: 'Shape', type: 'EXTENDS' });
    expect(m.issues).toEqual([]);
  });

  it('1. nota sin cerrar al final del archivo es un error', () => {
    const m = parsePuml(`@startuml\nclass A\nnote right of A\n  sin fin\n@enduml`);
    expect(m.issues).toEqual([{ line: 3, severity: 'error', message: expect.stringContaining('Nota sin cerrar') }]);
  });

  it('2. notas: posicional, multilínea, flotante enlazada y sobre enlace', () => {
    const m = parsePuml(`@startuml\nclass A\nclass B\nnote left of A : uno\nnote right of B\n  dos\n  tres\nend note\nnote "flota" as N1\nA .. N1\nA --> B\nnote on link : enlace\n@enduml`);
    expect(m.notes).toEqual([
      { id: 'note_4', text: 'uno', position: 'left', anchor: 'A', line: 4 },
      { id: 'note_5', text: 'dos\ntres', position: 'right', anchor: 'B', line: 5 },
      { id: 'N1', text: 'flota', anchor: 'A', line: 9 },
      { id: 'note_12', text: 'enlace', linkLine: 11, line: 12 },
    ]);
    expect(m.relationships).toHaveLength(1);
    expect(m.types.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('3. colores de cabecera (4 formas) y miembros del cuerpo', () => {
    const m = parsePuml(`@startuml\nclass A #lightblue {\n  + x: int\n}\nclass B ##[dashed]red\nclass C #pink;line:red\nclass D <<Entity>> #F0F0F0 {\n  - y: String\n}\n@enduml`);
    expect(m.issues).toEqual([]);
    expect(m.types.map((t) => [t.id, t.color, t.lineColor])).toEqual([
      ['A', 'lightblue', undefined],
      ['B', undefined, 'red'],
      ['C', 'pink', 'red'],
      ['D', '#F0F0F0', undefined],
    ]);
    expect(m.types[0]?.attributes).toHaveLength(1);
    expect(m.types[3]).toMatchObject({ stereotypes: ['Entity'] });
    expect(m.types[3]?.attributes).toHaveLength(1);
  });

  const heads: [string, string, string, string, string, string][] = [
    ['--', 'A', 'B', 'ASSOCIATION', 'none', 'none'],
    ['..', 'A', 'B', 'DEPENDENCY', 'none', 'none'],
    ['<-->', 'A', 'B', 'ASSOCIATION', 'open', 'open'],
    ['*--', 'A', 'B', 'COMPOSITION', 'diamond-filled', 'none'],
    ['--*', 'B', 'A', 'COMPOSITION', 'diamond-filled', 'none'],
    ['o--', 'A', 'B', 'AGGREGATION', 'diamond', 'none'],
    ['x--', 'A', 'B', 'ASSOCIATION', 'cross', 'none'],
    ['+--', 'A', 'B', 'ASSOCIATION', 'plus', 'none'],
    ['#--', 'A', 'B', 'ASSOCIATION', 'square', 'none'],
    ['-->', 'A', 'B', 'ASSOCIATION', 'none', 'open'],
    ['<|--', 'B', 'A', 'EXTENDS', 'none', 'triangle'],
    ['..|>', 'A', 'B', 'IMPLEMENTS', 'none', 'triangle'],
  ];
  for (const [arrow, source, target, type, sh, th] of heads) {
    it(`4. A ${arrow} B → ${type} ${sh}/${th}`, () => {
      const m = parsePuml(`@startuml\nclass A\nclass B\nA ${arrow} B\n@enduml`);
      expect(m.relationships[0]).toMatchObject({ source, target, type, sourceHead: sh, targetHead: th });
    });
  }

  it('4. multiplicidades y flecha de etiqueta', () => {
    const m = parsePuml(`@startuml\nclass Car\nclass Wheel\nCar "1" *-- "4" Wheel : has >\nWheel "n" --> Car : < de\nCar <-- Wheel : x >\n@enduml`);
    expect(m.relationships[0]).toMatchObject({ type: 'COMPOSITION', sourceLabel: '1', targetLabel: '4', label: 'has', labelArrow: 'forward' });
    expect(m.relationships[1]).toMatchObject({ sourceLabel: 'n', label: 'de', labelArrow: 'backward' });
    expect(m.relationships[2]).toMatchObject({ source: 'Wheel', target: 'Car', label: 'x', labelArrow: 'backward' });
  });

  it('4. estilo y dirección de la flecha; [hidden] se omite', () => {
    const m = parsePuml(`@startuml\nclass A\nclass B\nA -[#red,bold]-> B\nA -up-|> B\nA -[hidden]- B\nA .left.> B\nA <-up- B\n@enduml`);
    expect(m.relationships).toHaveLength(4);
    expect(m.relationships[0]).toMatchObject({ type: 'ASSOCIATION', style: { color: 'red', bold: true } });
    expect(m.relationships[1]).toMatchObject({ type: 'EXTENDS', hint: 'up' });
    expect(m.relationships[2]).toMatchObject({ type: 'DEPENDENCY', hint: 'left' });
    expect(m.relationships[3]).toMatchObject({ source: 'B', target: 'A', hint: 'down' });
  });

  it('5. namespace y paquetes anidados guardan el nombre completo; la capa del generador no', () => {
    const m = parsePuml(`@startuml\nnamespace a {\n  namespace b {\n    class C\n  }\n  class D\n}\npackage com.foo {\n  package bar {\n    class E\n  }\n}\n@enduml`);
    expect(m.issues).toEqual([]);
    expect(m.types.map((t) => [t.id, t.packageName])).toEqual([['C', 'a.b'], ['D', 'a'], ['E', 'com.foo.bar']]);
    expect(m.packages.find((p) => p.name === 'a.b')?.layer).toBe('a');
    expect(m.packages.find((p) => p.name === 'com.foo.bar')?.layer).toBe('com.foo');
  });

  it('5. nombre completo en una relación resuelve al tipo declarado', () => {
    const m = parsePuml(`@startuml\npackage net.dummy {\n  class Person\n}\nclass X\nnet.dummy.Person --> X\n@enduml`);
    expect(m.types.map((t) => t.id)).toEqual(['Person', 'X']);
    expect(m.relationships[0]).toMatchObject({ source: 'Person', target: 'X' });
  });

  it('6. direction por defecto TB, LR con la directiva; hide guarda las líneas', () => {
    expect(parsePuml('@startuml\nclass A\n@enduml').direction).toBe('TB');
    const m = parsePuml(`@startuml\nleft to right direction\nhide empty members\nshow Foo\nremove @unlinked\nclass A\n@enduml`);
    expect(m.direction).toBe('LR');
    expect(m.hide).toEqual(['hide empty members', 'show Foo', 'remove @unlinked']);
    expect(m.summaryMode).toBe(false);
    expect(parsePuml('@startuml\nhide members\n@enduml').summaryMode).toBe(true);
  });

  it('6. preprocesador: warning en lugar de descarte silencioso', () => {
    const m = parsePuml(`@startuml\n!include x.puml\n!define K 1\n!theme plain\nclass A\n@enduml`);
    expect(m.issues.map((i) => [i.line, i.severity, i.message])).toEqual([
      [2, 'warning', 'Directiva de preprocesador no soportada: !include x.puml'],
      [3, 'warning', 'Directiva de preprocesador no soportada: !define K 1'],
      [4, 'warning', 'Directiva de preprocesador no soportada: !theme plain'],
    ]);
  });

  it('7. tipos nuevos: categoría class y estereotipo con su palabra clave', () => {
    const kinds = ['struct', 'entity', 'exception', 'protocol', 'object', 'circle', 'diamond', 'metaclass', 'stereotype', 'dataclass'];
    const m = parsePuml(`@startuml\n${kinds.map((k, i) => `${k} T${i}`).join('\n')}\n@enduml`);
    expect(m.issues).toEqual([]);
    expect(m.types.map((t) => [t.declaredKind, t.category, t.stereotypes[0]])).toEqual(kinds.map((k) => [k, 'class', k]));
  });

  it('8. clase asociación marca la relación A–B (en cualquier orden)', () => {
    const m = parsePuml(`@startuml\nclass A\nclass B\nclass C\nclass D\n(A, B) .. C\nA -- B\nD .. (A, B)\n@enduml`);
    expect(m.relationships).toHaveLength(1);
    expect(m.relationships[0]).toMatchObject({ source: 'A', target: 'B', associationClass: 'D' });
  });

  it('8. clase asociación sin relación previa la crea sin cabezas', () => {
    const m = parsePuml(`@startuml\nclass A\nclass B\nclass C\n(A, B) .. C\n@enduml`);
    expect(m.relationships).toEqual([
      { source: 'A', target: 'B', type: 'ASSOCIATION', sourceHead: 'none', targetHead: 'none', line: 5, associationClass: 'C' },
    ]);
  });

  it('8. A::campo resuelve al tipo y guarda el miembro', () => {
    const m = parsePuml(`@startuml\nclass A\nclass B\nA::campo --> B::otro\n@enduml`);
    expect(m.types.map((t) => t.id)).toEqual(['A', 'B']);
    expect(m.relationships[0]).toMatchObject({ source: 'A', target: 'B', sourceMember: 'campo', targetMember: 'otro' });
  });
});

describe('parsePuml — tipos de flecha', () => {
  const cases: [string, string, string, string][] = [
    ['-->', 'A', 'B', 'ASSOCIATION'],
    ['..>', 'A', 'B', 'DEPENDENCY'],
    ['<--', 'B', 'A', 'ASSOCIATION'],
    ['<..', 'B', 'A', 'DEPENDENCY'],
    ['--|>', 'A', 'B', 'EXTENDS'],
    ['..|>', 'A', 'B', 'IMPLEMENTS'],
    ['<|--', 'B', 'A', 'EXTENDS'],
    ['<|..', 'B', 'A', 'IMPLEMENTS'],
    ['-up->', 'A', 'B', 'ASSOCIATION'],
    ['.down.>', 'A', 'B', 'DEPENDENCY'],
  ];
  for (const [arrow, source, target, type] of cases) {
    it(`A ${arrow} B → ${source}→${target} ${type}`, () => {
      const m = parsePuml(`@startuml\nclass A\nclass B\nA ${arrow} B\n@enduml`);
      expect(m.relationships).toHaveLength(1);
      expect(m.relationships[0]).toMatchObject({ source, target, type });
    });
  }
});
