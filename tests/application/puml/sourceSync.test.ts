import { describe, expect, it } from 'vitest';
import { parsePuml } from '../../../src/application/puml/parser';
import { createSourceIndex, lineMapping } from '../../../src/application/puml/sourceSync';

const SRC = [
  '@startuml', //                       1
  "' comentario", //                    2
  'package app {', //                   3
  '  class Order {', //                 4
  '    - id: long', //                  5
  '  }', //                             6
  '  interface Repo', //                7
  '}', //                               8
  'class Customer extends Base {', //   9
  '  + name: String', //               10
  '}', //                              11
  'Customer --> Order : compra', //    12
  'Order ..> Ghost', //                13
  '@enduml', //                        14
].join('\n');

describe('createSourceIndex: del cursor al elemento', () => {
  const index = createSourceIndex(parsePuml(SRC));

  it('una línea dentro del cuerpo de un tipo apunta a ese tipo', () => {
    expect(index.elementAt(4)).toEqual({ kind: 'type', id: 'Order' });
    expect(index.elementAt(5)).toEqual({ kind: 'type', id: 'Order' });
    expect(index.elementAt(6)).toEqual({ kind: 'type', id: 'Order' });
  });

  it('un tipo de una línea solo ocupa su línea', () => {
    expect(index.elementAt(7)).toEqual({ kind: 'type', id: 'Repo' });
  });

  it('una línea de relación apunta a la relación', () => {
    expect(index.elementAt(12)).toEqual({ kind: 'relation', line: 12 });
    expect(index.elementAt(13)).toEqual({ kind: 'relation', line: 13 });
  });

  it('la cabecera "class A extends B" es el tipo, no la relación que declara', () => {
    expect(index.elementAt(9)).toEqual({ kind: 'type', id: 'Customer' });
  });

  it('los tipos implícitos no se adueñan de la línea de su relación', () => {
    expect(index.elementAt(13)).not.toEqual({ kind: 'type', id: 'Ghost' });
  });

  it('las líneas que no son de ningún elemento devuelven null', () => {
    for (const line of [1, 2, 3, 8, 14, 99, 0]) expect(index.elementAt(line)).toBeNull();
  });
});

describe('createSourceIndex: del elemento a la línea', () => {
  const index = createSourceIndex(parsePuml(SRC));

  it('da el rango [line, endLine] de la declaración', () => {
    expect(index.rangeOf('Order')).toEqual({ line: 4, endLine: 6 });
    expect(index.rangeOf('Repo')).toEqual({ line: 7, endLine: 7 });
    expect(index.rangeOf('Customer')).toEqual({ line: 9, endLine: 11 });
  });

  it('un tipo implícito salta a la relación que lo nombra', () => {
    expect(index.rangeOf('Ghost')).toEqual({ line: 13, endLine: 13 });
  });

  it('un id desconocido no tiene rango', () => {
    expect(index.rangeOf('Nada')).toBeNull();
  });

  it('sin endLine (modelo armado a mano) el rango es la línea de la declaración', () => {
    const model = parsePuml(SRC);
    const order = model.types.find((t) => t.id === 'Order');
    if (order) delete order.endLine;
    expect(createSourceIndex(model).rangeOf('Order')).toEqual({ line: 4, endLine: 4 });
  });
});

describe('lineMapping: líneas del archivo de entrada ↔ texto combinado (!include)', () => {
  const ENTRY = 'c:/p/main.puml';
  const INC = 'c:/p/common.iuml';
  // main.puml: 1 @startuml · 2 !include common.iuml · 3 class A · 4 @enduml
  // common.iuml: 1 class X · 2 class Y
  const lineMap = [
    { file: ENTRY, line: 1 },
    { file: INC, line: 1 },
    { file: INC, line: 2 },
    { file: ENTRY, line: 3 },
    { file: ENTRY, line: 4 },
  ];
  const m = lineMapping(lineMap, ENTRY);

  it('una línea combinada de la entrada vuelve a su línea en el archivo', () => {
    expect(m.toEntry(1)).toBe(1);
    expect(m.toEntry(4)).toBe(3);
    expect(m.toEntry(5)).toBe(4);
  });

  it('una línea que viene de un incluido no está en el editor', () => {
    expect(m.toEntry(2)).toBeNull();
    expect(m.toEntry(3)).toBeNull();
  });

  it('una línea del editor va a su línea combinada', () => {
    expect(m.toCombined(1)).toBe(1);
    expect(m.toCombined(3)).toBe(4);
    expect(m.toCombined(4)).toBe(5);
  });

  it('la directiva !include se consume: no tiene línea combinada', () => {
    expect(m.toCombined(2)).toBeNull();
  });

  it('fuera de rango devuelve null', () => {
    expect(m.toEntry(0)).toBeNull();
    expect(m.toEntry(6)).toBeNull();
    expect(m.toCombined(9)).toBeNull();
  });

  it('sin mapa (sin !include) es la identidad', () => {
    const id = lineMapping(null, null);
    expect(id.toEntry(7)).toBe(7);
    expect(id.toCombined(7)).toBe(7);
  });
});
