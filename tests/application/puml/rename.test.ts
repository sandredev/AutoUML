import { describe, expect, it } from 'vitest';
import { parsePuml } from '../../../src/application/puml/parser';
import { validateRename } from '../../../src/application/puml/rename';

const SRC = '@startuml\nclass Order\nclass Customer\nCustomer --> Order\n@enduml';

describe('validateRename', () => {
  const model = parsePuml(SRC);

  it('acepta un identificador nuevo válido', () => {
    expect(validateRename(model, 'Order', 'Pedido')).toBeNull();
  });

  it('rechaza nombres vacíos o que no son identificadores', () => {
    expect(validateRename(model, 'Order', '')).toBe('invalid');
    expect(validateRename(model, 'Order', 'mi pedido')).toBe('invalid');
    expect(validateRename(model, 'Order', '9x')).toBe('invalid');
  });

  it('rechaza un nombre que ya usa otro tipo', () => {
    expect(validateRename(model, 'Order', 'Customer')).toBe('duplicate');
  });

  it('el mismo nombre no es un cambio', () => {
    expect(validateRename(model, 'Order', 'Order')).toBe('unchanged');
  });

  it('un tipo con alias o nombre distinto de su id no se renombra desde el lienzo', () => {
    const aliased = parsePuml('class "Pedido largo" as P\nclass Lista<T>');
    expect(validateRename(aliased, 'P', 'Q')).toBe('unsupported');
    expect(validateRename(aliased, 'Lista', 'Coleccion')).toBe('unsupported');
  });
});
