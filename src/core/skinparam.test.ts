import { describe, expect, it } from 'vitest';
import { parsePuml } from './parser';
import { plantColor, SkinparamReader } from './skinparam';

describe('SkinparamReader (T4)', () => {
  it('lee skinparam sueltos con la clave en minúsculas e ignora los no soportados', () => {
    const r = new SkinparamReader();
    expect(r.feed('skinparam ClassBackgroundColor #FFEECC')).toBe(true);
    expect(r.feed('skinparam linetype ortho')).toBe(true);
    expect(r.feed('skinparam shadowing false')).toBe(true);
    expect(r.values).toEqual({ classbackgroundcolor: '#FFEECC', linetype: 'ortho' });
  });

  it('lee bloques "skinparam class { … }" con el prefijo del bloque', () => {
    const r = new SkinparamReader();
    for (const l of ['skinparam class {', 'BackgroundColor LightBlue', 'BorderColor red', 'FontSize 9', '}']) r.feed(l, 1);
    expect(r.values).toEqual({ classbackgroundcolor: 'LightBlue', classbordercolor: 'red' });
    expect(r.warnings).toEqual([]);
  });

  it('un bloque sin cerrar no se traga el resto del archivo y deja un aviso', () => {
    const m = parsePuml('@startuml\nskinparam class {\nBackgroundColor Yellow\nclass A\nclass B\nA --> B\n@enduml');
    expect(m.types.map((t) => t.id)).toEqual(['A', 'B']);
    expect(m.relationships).toHaveLength(1);
    expect(m.skinparams?.classbackgroundcolor).toBe('Yellow');
    expect(m.issues.some((i) => i.line === 2 && /skinparam sin cerrar/.test(i.message))).toBe(true);
  });

  it('un bloque sin cerrar al final del archivo avisa con finish()', () => {
    const r = new SkinparamReader();
    r.feed('skinparam class {', 7);
    r.feed('BackgroundColor red', 8);
    r.finish();
    expect(r.warnings).toEqual([{ line: 7, message: 'Bloque skinparam sin cerrar (falta "}")' }]);
  });

  it('el parser guarda skinparams y los bloques cerrados no dejan avisos', () => {
    const m = parsePuml(
      '@startuml\nskinparam ArrowColor #333\nskinparam classAttributeIconSize 0\nskinparam package {\nBackgroundColor #EEE\n}\nclass A\n@enduml',
    );
    expect(m.skinparams).toEqual({ arrowcolor: '#333', classattributeiconsize: '0', packagebackgroundcolor: '#EEE' });
    expect(m.issues.filter((i) => /skinparam/i.test(i.message))).toEqual([]);
    expect(m.types).toHaveLength(1);
  });
});

describe('plantColor', () => {
  it('acepta #hex, nombres y #Nombre; rechaza lo demás', () => {
    expect(plantColor('#FA0')).toBe('#FA0');
    expect(plantColor('#LightBlue')).toBe('LightBlue');
    expect(plantColor('red')).toBe('red');
    expect(plantColor('#12')).toBeUndefined();
    expect(plantColor('linear(gradient)')).toBeUndefined();
    expect(plantColor(undefined)).toBeUndefined();
  });
});
