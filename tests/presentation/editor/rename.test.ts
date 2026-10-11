import { describe, expect, it } from 'vitest';
import { parsePuml } from '../../../src/application/puml/parser';
import { applyChanges, renameChanges } from '../../../src/presentation/editor/rename';

const SRC = [
  '@startuml',
  "' Order es la raíz del agregado",
  'package shop {',
  '  class Order <<entity>> {',
  '    - order: Order',
  '    - items: List<OrderItem>',
  '    + copy(): Order',
  '  }',
  '  class OrderItem',
  '}',
  'class Customer extends Base',
  'Customer "1" --> "*" Order : Order nueva >',
  'Order *-- OrderItem',
  'Order::items --> shop.Order',
  'note left of Order',
  '  Order se crea al pagar',
  'end note',
  "/' Order",
  "  en bloque '/",
  'hide Order',
  '@enduml',
].join('\n');

const rename = (text: string, from: string, to: string): string => applyChanges(text, renameChanges(text, from, to));

describe('renameChanges: identificador y referencias', () => {
  const out = rename(SRC, 'Order', 'Pedido');
  const lines = out.split('\n');

  it('renombra la declaración', () => {
    expect(lines[3]).toBe('  class Pedido <<entity>> {');
  });

  it('renombra los tipos de los miembros, pero no los nombres de los campos', () => {
    expect(lines[4]).toBe('    - order: Pedido');
    expect(lines[6]).toBe('    + copy(): Pedido');
  });

  it('no toca identificadores que solo contienen el nombre', () => {
    expect(lines[5]).toBe('    - items: List<OrderItem>');
    expect(lines[8]).toBe('  class OrderItem');
    expect(lines[12]).toBe('Pedido *-- OrderItem');
  });

  it('renombra los extremos de las relaciones, no su etiqueta', () => {
    expect(lines[11]).toBe('Customer "1" --> "*" Pedido : Order nueva >');
  });

  it('renombra las referencias calificadas y las de miembro (A::campo, paquete.A)', () => {
    expect(lines[13]).toBe('Pedido::items --> shop.Pedido');
  });

  it('renombra el ancla de la nota y las reglas hide, no el texto de la nota', () => {
    expect(lines[14]).toBe('note left of Pedido');
    expect(lines[15]).toBe('  Order se crea al pagar');
    expect(lines[19]).toBe('hide Pedido');
  });

  it('no toca los comentarios', () => {
    expect(lines[1]).toBe("' Order es la raíz del agregado");
    expect(lines[17]).toBe("/' Order");
  });

  it('el resultado se parsea con el tipo renombrado y las mismas relaciones', () => {
    const before = parsePuml(SRC);
    const after = parsePuml(out);
    expect(after.types.map((t) => t.id).sort()).toEqual(
      before.types.map((t) => (t.id === 'Order' ? 'Pedido' : t.id)).sort(),
    );
    expect(after.relationships).toHaveLength(before.relationships.length);
    expect(after.types.some((t) => t.id === 'Order')).toBe(false);
  });

  it('respeta los finales de línea CRLF (las posiciones son del texto original)', () => {
    const crlf = 'class A\r\nA --> B\r\n';
    expect(rename(crlf, 'A', 'Z')).toBe('class Z\r\nZ --> B\r\n');
  });

  it('las referencias entre comillas también cuentan', () => {
    expect(rename('class A\n"A" --> B', 'A', 'Z')).toBe('class Z\n"Z" --> B');
  });
});
