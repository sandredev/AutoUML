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
